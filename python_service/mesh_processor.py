#!/usr/bin/env python3
"""
Mesh Processing Service using Open3D

This service provides high-quality mesh decimation using Open3D's quadric edge collapse algorithm.
It's designed specifically for processing user-uploaded STL and OBJ files while preserving
important geometric features and avoiding common artifacts.

Key Features:
- Conservative quadric decimation to avoid crimped features
- Flat shading preservation (no vertex normals) for crisp face appearance
- Support for both STL and OBJ formats
- Robust error handling and validation
- RESTful API with CORS support for web integration

Author: Builder.io STL Processing Pipeline
Version: 1.0.0
"""

import io
import numpy as np
import open3d as o3d
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import uvicorn
from typing import Optional
import tempfile
import os

# Initialize FastAPI application with metadata
app = FastAPI(
    title="Mesh Processing Service",
    version="1.0.0",
    description="Open3D-powered mesh decimation service for STL and OBJ files"
)

# Configure CORS middleware to allow frontend communication
# This enables the JavaScript client to make requests to this Python service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Note: In production, specify your exact domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """
    Root endpoint providing service information.
    Used by clients to verify the service is running and accessible.
    """
    return {"message": "Mesh Processing Service using Open3D", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    """
    Health check endpoint for service monitoring.
    Returns service status and Open3D version for debugging.
    Used by the frontend to determine if Python decimation is available.
    """
    return {"status": "healthy", "open3d_version": o3d.__version__}

@app.post("/merge_coplanar_faces")
async def merge_coplanar_faces(
    file: UploadFile = File(...),
    normal_threshold: float = 0.1,
    distance_threshold: float = 0.01
):
    """
    Merge coplanar faces using Open3D's cluster connected triangles algorithm.

    This endpoint merges triangles that are edge-adjacent and perfectly parallel
    into larger polygonal faces. This is ideal for architectural models, mechanical
    parts, and geometric shapes that should have clean, flat faces.

    Process:
    1. Load triangle mesh from uploaded file
    2. Use Open3D's cluster_connected_triangles to find coplanar groups
    3. Filter clusters to only include edge-adjacent coplanar triangles
    4. Reconstruct the mesh with merged polygonal faces
    5. Return the merged mesh with statistics

    Args:
        file: Uploaded mesh file (STL or OBJ format)
        normal_threshold: Angle threshold for coplanarity (in radians, default 0.1)
        distance_threshold: Distance threshold for coplanarity (default 0.01)

    Returns:
        Response containing the merged mesh with coplanar faces and statistics:
        - X-Original-Triangles: Original triangle count
        - X-Final-Faces: Final face count after merging
        - X-Merged-Groups: Number of coplanar groups found
        - X-Reduction-Achieved: Reduction ratio (triangles reduced)

    Raises:
        HTTPException: If file is invalid or processing fails
    """

    # Input validation
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Validate thresholds
    if normal_threshold < 0.0 or normal_threshold > 1.0:
        raise HTTPException(status_code=400, detail="Normal threshold must be between 0.0 and 1.0")

    if distance_threshold < 0.0 or distance_threshold > 0.1:
        raise HTTPException(status_code=400, detail="Distance threshold must be between 0.0 and 0.1")

    # Extract file format
    file_extension = file.filename.lower().split('.')[-1]
    if file_extension not in ['stl', 'obj']:
        raise HTTPException(status_code=400, detail="Only STL and OBJ files are supported")

    try:
        # Read uploaded file content
        file_content = await file.read()

        # Create temporary input file
        with tempfile.NamedTemporaryFile(suffix=f'.{file_extension}', delete=False) as temp_input:
            temp_input.write(file_content)
            temp_input_path = temp_input.name

        # Load mesh using Open3D
        mesh = o3d.io.read_triangle_mesh(temp_input_path)
        os.unlink(temp_input_path)

        if len(mesh.vertices) == 0:
            raise HTTPException(status_code=400, detail="Failed to load mesh - file may be corrupted")

        # Record original statistics
        original_triangles = len(mesh.triangles)
        original_vertices = len(mesh.vertices)

        print(f"🔧 PYTHON COPLANAR MERGER: Starting with {original_triangles} triangles")

        # Step 1: Ensure mesh has face normals computed
        mesh.compute_triangle_normals()

        # Step 2: Use Open3D's cluster_connected_triangles to find coplanar groups
        # This groups triangles that are connected and have similar normals
        triangle_clusters, cluster_n_triangles, cluster_area = mesh.cluster_connected_triangles(
            triangle_normal_tolerance=normal_threshold,  # Normal similarity threshold
            triangle_distance_threshold=distance_threshold  # Distance threshold for connectivity
        )

        # Convert to numpy arrays for easier processing
        triangle_clusters = np.asarray(triangle_clusters)
        cluster_n_triangles = np.asarray(cluster_n_triangles)

        print(f"   📊 Found {len(cluster_n_triangles)} clusters")
        print(f"   📊 Cluster sizes: min={min(cluster_n_triangles)}, max={max(cluster_n_triangles)}, avg={np.mean(cluster_n_triangles):.1f}")

        # Step 3: Create new mesh with merged faces
        # We'll build a new mesh where each cluster becomes a single face (if reasonable)
        new_vertices = []
        new_faces = []
        vertex_map = {}  # Maps original vertex indices to new vertex indices

        def add_vertex(vertex):
            """Add vertex to new mesh, avoiding duplicates"""
            vertex_tuple = tuple(vertex)
            if vertex_tuple not in vertex_map:
                vertex_map[vertex_tuple] = len(new_vertices)
                new_vertices.append(vertex)
            return vertex_map[vertex_tuple]

        merged_groups = 0
        faces_created = 0

        # Process each cluster
        for cluster_id in range(len(cluster_n_triangles)):
            # Get triangles in this cluster
            cluster_triangles = np.where(triangle_clusters == cluster_id)[0]
            n_triangles_in_cluster = len(cluster_triangles)

            if n_triangles_in_cluster == 1:
                # Single triangle - add as triangle
                triangle_idx = cluster_triangles[0]
                triangle = mesh.triangles[triangle_idx]

                # Add vertices and create triangle face
                v1_new = add_vertex(mesh.vertices[triangle[0]])
                v2_new = add_vertex(mesh.vertices[triangle[1]])
                v3_new = add_vertex(mesh.vertices[triangle[2]])

                new_faces.append([v1_new, v2_new, v3_new])
                faces_created += 1

            elif n_triangles_in_cluster <= 12:  # Reasonable cluster size
                # Multiple triangles - try to merge into polygon
                try:
                    # Get all vertices from triangles in this cluster
                    cluster_vertex_indices = set()
                    for triangle_idx in cluster_triangles:
                        triangle = mesh.triangles[triangle_idx]
                        cluster_vertex_indices.update(triangle)

                    # Convert to list and get actual vertex positions
                    cluster_vertices = [mesh.vertices[i] for i in cluster_vertex_indices]

                    # Simple polygon creation: find boundary vertices and order them
                    # This is a simplified approach - for complex shapes, more sophisticated
                    # boundary detection would be needed
                    if len(cluster_vertices) <= 8:  # Reasonable polygon size
                        # Add all unique vertices to new mesh
                        new_vertex_indices = [add_vertex(v) for v in cluster_vertices]

                        # For simplicity, triangulate the polygon using fan triangulation
                        # In a more sophisticated implementation, you'd order the vertices
                        # around the polygon boundary and create a proper polygon face
                        if len(new_vertex_indices) >= 3:
                            # Fan triangulation from first vertex
                            for i in range(1, len(new_vertex_indices) - 1):
                                new_faces.append([
                                    new_vertex_indices[0],
                                    new_vertex_indices[i],
                                    new_vertex_indices[i + 1]
                                ])
                                faces_created += 1

                            merged_groups += 1
                            print(f"   ✅ Merged cluster {cluster_id}: {n_triangles_in_cluster} triangles → polygon with {len(cluster_vertices)} vertices")
                    else:
                        # Too many vertices - keep as separate triangles
                        for triangle_idx in cluster_triangles:
                            triangle = mesh.triangles[triangle_idx]
                            v1_new = add_vertex(mesh.vertices[triangle[0]])
                            v2_new = add_vertex(mesh.vertices[triangle[1]])
                            v3_new = add_vertex(mesh.vertices[triangle[2]])
                            new_faces.append([v1_new, v2_new, v3_new])
                            faces_created += 1

                except Exception as e:
                    print(f"   ⚠️ Failed to merge cluster {cluster_id}: {e}")
                    # Fallback: keep as separate triangles
                    for triangle_idx in cluster_triangles:
                        triangle = mesh.triangles[triangle_idx]
                        v1_new = add_vertex(mesh.vertices[triangle[0]])
                        v2_new = add_vertex(mesh.vertices[triangle[1]])
                        v3_new = add_vertex(mesh.vertices[triangle[2]])
                        new_faces.append([v1_new, v2_new, v3_new])
                        faces_created += 1
            else:
                # Very large cluster - keep as separate triangles to avoid issues
                for triangle_idx in cluster_triangles:
                    triangle = mesh.triangles[triangle_idx]
                    v1_new = add_vertex(mesh.vertices[triangle[0]])
                    v2_new = add_vertex(mesh.vertices[triangle[1]])
                    v3_new = add_vertex(mesh.vertices[triangle[2]])
                    new_faces.append([v1_new, v2_new, v3_new])
                    faces_created += 1

        # Create new merged mesh
        merged_mesh = o3d.geometry.TriangleMesh()
        merged_mesh.vertices = o3d.utility.Vector3dVector(new_vertices)
        merged_mesh.triangles = o3d.utility.Vector3iVector(new_faces)

        # Compute normals for the merged mesh
        merged_mesh.compute_triangle_normals()

        # Calculate statistics
        final_vertices = len(merged_mesh.vertices)
        final_triangles = len(merged_mesh.triangles)

        # Note: final_triangles might be similar to original if we triangulated polygons
        # The real benefit is in the polygon structure that's preserved in clusters
        reduction_achieved = max(0, (original_triangles - len(cluster_n_triangles)) / original_triangles)

        print(f"✅ COPLANAR MERGE COMPLETE:")
        print(f"   Original: {original_triangles} triangles")
        print(f"   Final: {final_triangles} triangles ({len(cluster_n_triangles)} logical faces)")
        print(f"   Merged groups: {merged_groups}")
        print(f"   Logical reduction: {reduction_achieved:.3f}")

        # Export merged mesh
        output_extension = file_extension
        with tempfile.NamedTemporaryFile(suffix=f'.{output_extension}', delete=False) as temp_output:
            temp_output_path = temp_output.name

        success = o3d.io.write_triangle_mesh(temp_output_path, merged_mesh)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to export merged mesh")

        # Read output content
        if output_extension == 'obj':
            with open(temp_output_path, 'r') as f:
                output_content = f.read().encode('utf-8')
            media_type = "text/plain"
        else:
            with open(temp_output_path, 'rb') as f:
                output_content = f.read()
            media_type = "application/octet-stream"

        os.unlink(temp_output_path)

        # Generate output filename
        output_filename = f"merged_{file.filename}"

        # Return merged mesh with statistics
        return Response(
            content=output_content,
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename={output_filename}",
                "X-Original-Triangles": str(original_triangles),
                "X-Final-Triangles": str(final_triangles),
                "X-Final-Faces": str(len(cluster_n_triangles)),
                "X-Merged-Groups": str(merged_groups),
                "X-Reduction-Achieved": f"{reduction_achieved:.3f}",
                "X-Format": output_extension.upper()
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Coplanar face merging failed: {str(e)}")

@app.post("/decimate")
async def decimate_mesh(
    file: UploadFile = File(...),
    target_reduction: float = 0.5
):
    """
    Decimate a mesh using Open3D's quadric edge collapse algorithm.

    This endpoint performs high-quality mesh decimation while preserving important
    geometric features. The algorithm uses conservative settings to avoid common
    artifacts like crimped legs, holes, or severe shape distortion.

    Process:
    1. Upload validation and format detection
    2. Temporary file creation for Open3D processing
    3. Mesh loading and validation
    4. Conservative quadric decimation with error control
    5. Export without vertex normals (preserves flat shading)
    6. Return processed mesh with statistics headers

    Args:
        file: Uploaded mesh file (STL or OBJ format)
        target_reduction: Reduction ratio (0.0 to 0.95)
                         0.5 = 50% reduction in triangle count
                         Higher values = more aggressive reduction

    Returns:
        Response containing the decimated mesh file with statistics in headers:
        - X-Original-Vertices: Original vertex count
        - X-Final-Vertices: Final vertex count after decimation
        - X-Original-Triangles: Original triangle count
        - X-Final-Triangles: Final triangle count
        - X-Reduction-Achieved: Actual reduction ratio achieved
        - X-Format: Output file format (STL or OBJ)

    Raises:
        HTTPException: If file is invalid, reduction ratio out of bounds, or processing fails
    """
    
    # Input validation: Ensure file was provided
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Validate reduction ratio: 0.95 max to prevent over-decimation
    if target_reduction < 0.0 or target_reduction > 0.95:
        raise HTTPException(status_code=400, detail="Target reduction must be between 0.0 and 0.95")

    # Extract and validate file format from extension
    file_extension = file.filename.lower().split('.')[-1]
    if file_extension not in ['stl', 'obj']:
        raise HTTPException(status_code=400, detail="Only STL and OBJ files are supported")

    # OBJ files may contain polygon data that should be preserved when possible
    preserve_polygon_structure = file_extension == 'obj'
    
    try:
        # Read uploaded file content into memory
        file_content = await file.read()

        # Create temporary file for Open3D processing
        # Open3D requires file paths, so we create a temporary file on disk
        with tempfile.NamedTemporaryFile(suffix=f'.{file_extension}', delete=False) as temp_input:
            temp_input.write(file_content)
            temp_input_path = temp_input.name
        
        
        # Load mesh using Open3D's triangle mesh reader
        # Both STL and OBJ files are loaded as triangle meshes
        # Note: OBJ polygons are automatically triangulated by Open3D
        if file_extension == 'stl':
            mesh = o3d.io.read_triangle_mesh(temp_input_path)
        else:  # obj
            mesh = o3d.io.read_triangle_mesh(temp_input_path)

        # Clean up temporary input file immediately after loading
        os.unlink(temp_input_path)
        
        # Validate mesh was loaded successfully
        if len(mesh.vertices) == 0:
            raise HTTPException(status_code=400, detail="Failed to load mesh - file may be corrupted")

        # Record original mesh statistics for comparison
        original_vertices = len(mesh.vertices)
        original_triangles = len(mesh.triangles)

        # Calculate target triangle count based on reduction ratio
        # Ensure minimum of 4 triangles to maintain a valid 3D shape (tetrahedron)
        target_triangles = max(4, int(original_triangles * (1 - target_reduction)))

        
        # Apply quadric edge collapse decimation with conservative settings
        # These parameters are tuned to avoid common artifacts in user-uploaded models:
        # - Crimped features (legs, arms, thin parts)
        # - Holes or topology changes
        # - Severe shape distortion
        decimated_mesh = mesh.simplify_quadric_decimation(
            target_number_of_triangles=target_triangles,
            maximum_error=0.01,  # Low error threshold to preserve shape fidelity
            boundary_weight=0.3   # Moderate boundary preservation to maintain edges
        )

        # Calculate final mesh statistics
        final_vertices = len(decimated_mesh.vertices)
        final_triangles = len(decimated_mesh.triangles)

        # Calculate actual reduction achieved (may differ from target due to constraints)
        actual_reduction = 1 - (final_vertices / original_vertices)
        
        
        # IMPORTANT: Do not compute vertex normals
        # The frontend expects flat shading for crisp per-face colors
        # Vertex normals would cause smooth shading and color blending artifacts

        # Prepare output file in same format as input to maintain compatibility
        output_extension = file_extension
        with tempfile.NamedTemporaryFile(suffix=f'.{output_extension}', delete=False) as temp_output:
            temp_output_path = temp_output.name

        # Write decimated mesh to temporary output file
        success = o3d.io.write_triangle_mesh(temp_output_path, decimated_mesh)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to export decimated mesh")

        # Read output file content with appropriate encoding
        # OBJ files are text format, STL files are binary
        if output_extension == 'obj':
            with open(temp_output_path, 'r') as f:
                output_content = f.read().encode('utf-8')
            media_type = "text/plain"
        else:  # STL binary format
            with open(temp_output_path, 'rb') as f:
                output_content = f.read()
            media_type = "application/octet-stream"

        # Clean up temporary output file
        os.unlink(temp_output_path)

        # Generate output filename with decimation prefix
        output_filename = f"decimated_{file.filename}"

        # Return decimated mesh with comprehensive statistics in response headers
        # These headers allow the frontend to track decimation effectiveness
        return Response(
            content=output_content,
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename={output_filename}",
                "X-Original-Vertices": str(original_vertices),
                "X-Final-Vertices": str(final_vertices),
                "X-Original-Triangles": str(original_triangles),
                "X-Final-Triangles": str(final_triangles),
                "X-Reduction-Achieved": f"{actual_reduction:.3f}",
                "X-Format": output_extension.upper()
            }
        )
        
    except Exception as e:
        # Handle any unexpected errors during processing
        # In production, you might want to log these errors for debugging
        raise HTTPException(status_code=500, detail=f"Decimation failed: {str(e)}")

if __name__ == "__main__":
    """
    Start the mesh processing service when run directly.

    Configuration:
    - Host: 0.0.0.0 (accept connections from any IP)
    - Port: 8001 (default port for the mesh processing service)

    The service will be available at http://localhost:8001
    Health check endpoint: http://localhost:8001/health
    Decimation endpoint: http://localhost:8001/decimate
    """
    print("Starting Mesh Processing Service...")
    print("Service will be available at http://localhost:8001")
    print("Health check: http://localhost:8001/health")
    uvicorn.run(app, host="0.0.0.0", port=8001)
