import * as THREE from "three";

export class PolygonGeometryBuilder {
  static createFace(
    vertices: THREE.Vector3[],
    faceType: "triangle" | "quad" | "polygon",
  ): PolygonFace {
    return {
      vertices,
      faceType,
      normal: this.calculateFaceNormal(vertices),
    };
  }

  static calculateFaceNormal(vertices: THREE.Vector3[]): THREE.Vector3 {
    if (vertices.length < 3) return new THREE.Vector3(0, 0, 1);

    const edge1 = new THREE.Vector3().subVectors(vertices[1], vertices[0]);
    const edge2 = new THREE.Vector3().subVectors(vertices[2], vertices[0]);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2);

    if (normal.length() < 1e-6) {
      if (vertices.length > 3) {
        const edge3 = new THREE.Vector3().subVectors(vertices[3], vertices[0]);
        normal.crossVectors(edge1, edge3);
      }
      if (normal.length() < 1e-6) {
        return new THREE.Vector3(0, 1, 0);
      }
    }

    return normal.normalize();
  }

  static ensureOutwardFaceWinding(
    face: PolygonFace,
    geometryCenter?: THREE.Vector3,
  ): PolygonFace {
    if (!geometryCenter) {
      geometryCenter = new THREE.Vector3();
      face.vertices.forEach((v) => geometryCenter!.add(v));
      geometryCenter.divideScalar(face.vertices.length);
    }

    const faceCenter = new THREE.Vector3();
    face.vertices.forEach((v) => faceCenter.add(v));
    faceCenter.divideScalar(face.vertices.length);

    const toFace = new THREE.Vector3().subVectors(faceCenter, geometryCenter);
    const dot = face.normal.dot(toFace);

    if (dot < 0) {
      return {
        vertices: [...face.vertices].reverse(),
        faceType: face.faceType,
        normal: face.normal.clone().negate(),
      };
    }

    return face;
  }

  static createBoxWithQuads(
    width: number,
    height: number,
    depth: number,
  ): PolygonGeometry {
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    const vertices = [
      new THREE.Vector3(-w, -h, -d), // 0
      new THREE.Vector3(w, -h, -d), // 1
      new THREE.Vector3(w, h, -d), // 2
      new THREE.Vector3(-w, h, -d), // 3
      new THREE.Vector3(-w, -h, d), // 4
      new THREE.Vector3(w, -h, d), // 5
      new THREE.Vector3(w, h, d), // 6
      new THREE.Vector3(-w, h, d), // 7
    ];

    const faces = [
      this.createFace(
        [vertices[0], vertices[1], vertices[2], vertices[3]],
        "quad",
      ), // front
      this.createFace(
        [vertices[5], vertices[4], vertices[7], vertices[6]],
        "quad",
      ), // back
      this.createFace(
        [vertices[4], vertices[0], vertices[3], vertices[7]],
        "quad",
      ), // left
      this.createFace(
        [vertices[1], vertices[5], vertices[6], vertices[2]],
        "quad",
      ), // right
      this.createFace(
        [vertices[3], vertices[2], vertices[6], vertices[7]],
        "quad",
      ), // top
      this.createFace(
        [vertices[0], vertices[4], vertices[5], vertices[1]],
        "quad",
      ), // bottom
    ];

    return { vertices, faces, type: "box" };
  }

  static createTetrahedron(size: number): PolygonGeometry {
    const s = size / 2;
    const h = s * Math.sqrt(2 / 3);

    const vertices = [
      new THREE.Vector3(0, h, 0),
      new THREE.Vector3(-s, -h / 3, s),
      new THREE.Vector3(s, -h / 3, s),
      new THREE.Vector3(0, -h / 3, -s),
    ];

    const faces = [
      this.createFace([vertices[0], vertices[1], vertices[2]], "triangle"),
      this.createFace([vertices[0], vertices[2], vertices[3]], "triangle"),
      this.createFace([vertices[0], vertices[3], vertices[1]], "triangle"),
      this.createFace([vertices[3], vertices[2], vertices[1]], "triangle"),
    ];

    return { vertices, faces, type: "tetrahedron" };
  }

  static createOctahedron(size: number): PolygonGeometry {
    const s = size / 2;

    const vertices = [
      new THREE.Vector3(0, s, 0),
      new THREE.Vector3(0, -s, 0),
      new THREE.Vector3(s, 0, 0),
      new THREE.Vector3(-s, 0, 0),
      new THREE.Vector3(0, 0, s),
      new THREE.Vector3(0, 0, -s),
    ];

    const faces = [
      this.createFace([vertices[0], vertices[4], vertices[2]], "triangle"),
      this.createFace([vertices[0], vertices[2], vertices[5]], "triangle"),
      this.createFace([vertices[0], vertices[5], vertices[3]], "triangle"),
      this.createFace([vertices[0], vertices[3], vertices[4]], "triangle"),
      this.createFace([vertices[1], vertices[2], vertices[4]], "triangle"),
      this.createFace([vertices[1], vertices[5], vertices[2]], "triangle"),
      this.createFace([vertices[1], vertices[3], vertices[5]], "triangle"),
      this.createFace([vertices[1], vertices[4], vertices[3]], "triangle"),
    ];

    return { vertices, faces, type: "octahedron" };
  }

  static createIcosahedron(size: number): PolygonGeometry {
    const phi = (1 + Math.sqrt(5)) / 2;
    const s = size / 2;

    const vertices = [
      new THREE.Vector3(-s, s * phi, 0),
      new THREE.Vector3(s, s * phi, 0),
      new THREE.Vector3(-s, -s * phi, 0),
      new THREE.Vector3(s, -s * phi, 0),
      new THREE.Vector3(0, -s, s * phi),
      new THREE.Vector3(0, s, s * phi),
      new THREE.Vector3(0, -s, -s * phi),
      new THREE.Vector3(0, s, -s * phi),
      new THREE.Vector3(s * phi, 0, -s),
      new THREE.Vector3(s * phi, 0, s),
      new THREE.Vector3(-s * phi, 0, -s),
      new THREE.Vector3(-s * phi, 0, s),
    ];

    const faces = [
      this.createFace([vertices[0], vertices[11], vertices[5]], "triangle"),
      this.createFace([vertices[0], vertices[5], vertices[1]], "triangle"),
      this.createFace([vertices[0], vertices[1], vertices[7]], "triangle"),
      this.createFace([vertices[0], vertices[7], vertices[10]], "triangle"),
      this.createFace([vertices[0], vertices[10], vertices[11]], "triangle"),
      this.createFace([vertices[1], vertices[5], vertices[9]], "triangle"),
      this.createFace([vertices[5], vertices[11], vertices[4]], "triangle"),
      this.createFace([vertices[11], vertices[10], vertices[2]], "triangle"),
      this.createFace([vertices[10], vertices[7], vertices[6]], "triangle"),
      this.createFace([vertices[7], vertices[1], vertices[8]], "triangle"),
      this.createFace([vertices[3], vertices[9], vertices[4]], "triangle"),
      this.createFace([vertices[3], vertices[4], vertices[2]], "triangle"),
      this.createFace([vertices[3], vertices[2], vertices[6]], "triangle"),
      this.createFace([vertices[3], vertices[6], vertices[8]], "triangle"),
      this.createFace([vertices[3], vertices[8], vertices[9]], "triangle"),
      this.createFace([vertices[4], vertices[9], vertices[5]], "triangle"),
      this.createFace([vertices[2], vertices[4], vertices[11]], "triangle"),
      this.createFace([vertices[6], vertices[2], vertices[10]], "triangle"),
      this.createFace([vertices[8], vertices[6], vertices[7]], "triangle"),
      this.createFace([vertices[9], vertices[8], vertices[1]], "triangle"),
    ];

    return { vertices, faces, type: "icosahedron" };
  }

  static createGearWheel(
    innerRadius: number,
    outerRadius: number,
    height: number,
    teeth: number,
  ): PolygonGeometry {
    const vertices: THREE.Vector3[] = [];
    const faces: PolygonFace[] = [];
    const h = height / 2;

    const topVertices: THREE.Vector3[] = [];
    const bottomVertices: THREE.Vector3[] = [];

    for (let i = 0; i < teeth; i++) {
      const baseAngle = (i / teeth) * Math.PI * 2;
      const toothHalfWidth = (Math.PI / teeth) * 0.3;

      const angles = [
        baseAngle - toothHalfWidth,
        baseAngle - toothHalfWidth * 0.5,
        baseAngle + toothHalfWidth * 0.5,
        baseAngle + toothHalfWidth,
      ];

      const radii = [innerRadius, outerRadius, outerRadius, innerRadius];

      for (let j = 0; j < 4; j++) {
        const x = radii[j] * Math.cos(angles[j]);
        const z = radii[j] * Math.sin(angles[j]);

        topVertices.push(new THREE.Vector3(x, h, z));
        bottomVertices.push(new THREE.Vector3(x, -h, z));
      }
    }

    vertices.push(...topVertices, ...bottomVertices);

    faces.push(this.createFace(topVertices, "polygon"));
    faces.push(this.createFace([...bottomVertices].reverse(), "polygon"));

    for (let tooth = 0; tooth < teeth; tooth++) {
      const baseIndex = tooth * 4;

      const toothEdges = [
        [baseIndex, baseIndex + 1],
        [baseIndex + 1, baseIndex + 2],
        [baseIndex + 2, baseIndex + 3],
        [baseIndex + 3, (baseIndex + 4) % topVertices.length],
      ];

      for (const [i, next] of toothEdges) {
        faces.push(
          this.createFace(
            [
              bottomVertices[i],
              bottomVertices[next],
              topVertices[next],
              topVertices[i],
            ],
            "quad",
          ),
        );
      }
    }

    return { vertices, faces, type: "gear_wheel" };
  }

  static createStarShape(
    outerRadius: number,
    innerRadius: number,
    height: number,
    points: number = 5,
  ): PolygonGeometry {
    const vertices: THREE.Vector3[] = [];
    const faces: PolygonFace[] = [];
    const h = height / 2;

    const topVertices: THREE.Vector3[] = [];
    const bottomVertices: THREE.Vector3[] = [];

    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * Math.PI * 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);

      topVertices.push(new THREE.Vector3(x, h, z));
      bottomVertices.push(new THREE.Vector3(x, -h, z));
    }

    vertices.push(...topVertices, ...bottomVertices);

    faces.push(this.createFace(topVertices, "polygon"));
    faces.push(this.createFace([...bottomVertices].reverse(), "polygon"));

    for (let i = 0; i < topVertices.length; i++) {
      const next = (i + 1) % topVertices.length;
      faces.push(
        this.createFace(
          [
            bottomVertices[i],
            bottomVertices[next],
            topVertices[next],
            topVertices[i],
          ],
          "quad",
        ),
      );
    }

    return { vertices, faces, type: "star_shape" };
  }

  static createCrossShape(
    width: number,
    length: number,
    thickness: number,
    height: number,
  ): PolygonGeometry {
    const vertices: THREE.Vector3[] = [];
    const faces: PolygonFace[] = [];
    const h = height / 2;

    const w = width / 2;
    const l = length / 2;
    const t = thickness / 2;

    const crossProfile = [
      new THREE.Vector3(-t, -l, 0),
      new THREE.Vector3(t, -l, 0),
      new THREE.Vector3(t, -t, 0),
      new THREE.Vector3(w, -t, 0),
      new THREE.Vector3(w, t, 0),
      new THREE.Vector3(t, t, 0),
      new THREE.Vector3(t, l, 0),
      new THREE.Vector3(-t, l, 0),
      new THREE.Vector3(-t, t, 0),
      new THREE.Vector3(-w, t, 0),
      new THREE.Vector3(-w, -t, 0),
      new THREE.Vector3(-t, -t, 0),
    ];

    const topVertices = crossProfile.map((v) => new THREE.Vector3(v.x, h, v.y));
    const bottomVertices = crossProfile.map(
      (v) => new THREE.Vector3(v.x, -h, v.y),
    );

    vertices.push(...topVertices, ...bottomVertices);

    faces.push(this.createFace(topVertices, "polygon"));
    faces.push(this.createFace([...bottomVertices].reverse(), "polygon"));

    for (let i = 0; i < topVertices.length; i++) {
      const next = (i + 1) % topVertices.length;
      faces.push(
        this.createFace(
          [
            bottomVertices[i],
            bottomVertices[next],
            topVertices[next],
            topVertices[i],
          ],
          "quad",
        ),
      );
    }

    return { vertices, faces, type: "cross_shape" };
  }

  static toBufferGeometry(
    polygonGeometry: PolygonGeometry,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const faceData: FaceInfo[] = [];

    for (
      let faceIndex = 0;
      faceIndex < polygonGeometry.faces.length;
      faceIndex++
    ) {
      const face = polygonGeometry.faces[faceIndex];
      const triangulatedVertices = this.triangulateFace(face);
      const startIndex = positions.length / 3;

      for (const vertex of triangulatedVertices) {
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(face.normal.x, face.normal.y, face.normal.z);
      }

      const endIndex = positions.length / 3;
      faceData.push({
        type: face.faceType,
        startVertex: startIndex,
        endVertex: endIndex - 1,
        originalVertices: face.vertices,
        normal: face.normal,
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );

    let globalTriangleIndex = 0;
    const properPolygonFaces = faceData.map((face) => {
      const triangleCount =
        face.type === "triangle"
          ? 1
          : face.type === "quad"
            ? 2
            : face.originalVertices.length - 2;

      // Store the actual vertex indices for each triangle in this polygon
      const originalTriangulation = [];
      const startVertexIndex = face.startVertex;

      if (face.type === "triangle") {
        // Simple triangle: vertices 0, 1, 2
        originalTriangulation.push([0, 1, 2]);
      } else if (face.type === "quad") {
        // Quad split into two triangles: 0,1,2 and 0,2,3
        originalTriangulation.push([0, 1, 2]);
        originalTriangulation.push([0, 2, 3]);
      } else {
        // Complex polygon: fan triangulation from vertex 0
        for (let i = 1; i < face.originalVertices.length - 1; i++) {
          originalTriangulation.push([0, i, i + 1]);
        }
      }

      const triangleIndices = [];
      for (let i = 0; i < triangleCount; i++) {
        triangleIndices.push(globalTriangleIndex++);
      }

      return {
        type: face.type,
        originalVertices: face.originalVertices,
        normal: face.normal,
        triangleIndices: triangleIndices,
        originalTriangulation: originalTriangulation, // Store original vertex index mapping
      };
    });

    (geometry as any).polygonFaces = properPolygonFaces;
    (geometry as any).polygonType = polygonGeometry.type;
    (geometry as any).isProcedurallyGenerated = true;

    return geometry;
  }

  static toBufferGeometryWithCenterTriangulation(
    polygonGeometry: PolygonGeometry,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const faceData: FaceInfo[] = [];

    for (
      let faceIndex = 0;
      faceIndex < polygonGeometry.faces.length;
      faceIndex++
    ) {
      const face = polygonGeometry.faces[faceIndex];
      const triangulatedVertices = this.triangulateFromCenter(face);
      const startIndex = positions.length / 3;

      for (const vertex of triangulatedVertices) {
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(face.normal.x, face.normal.y, face.normal.z);
      }

      const endIndex = positions.length / 3;
      faceData.push({
        type: face.faceType,
        startVertex: startIndex,
        endVertex: endIndex - 1,
        originalVertices: face.vertices,
        normal: face.normal,
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );

    let globalTriangleIndex = 0;
    const properPolygonFaces = faceData.map((face) => {
      // For center triangulation, each polygon with N vertices creates N triangles
      const triangleCount = face.originalVertices.length;

      // Store the actual vertex indices for center triangulation
      const originalTriangulation = [];
      // Center triangulation: each triangle connects center to consecutive edge vertices
      for (let i = 0; i < face.originalVertices.length; i++) {
        const nextI = (i + 1) % face.originalVertices.length;
        // Center vertex is always last, edge vertices are 0 to N-1
        originalTriangulation.push([face.originalVertices.length, i, nextI]);
      }

      const triangleIndices = [];
      for (let i = 0; i < triangleCount; i++) {
        triangleIndices.push(globalTriangleIndex++);
      }

      return {
        type: face.type,
        originalVertices: face.originalVertices,
        normal: face.normal,
        triangleIndices: triangleIndices,
        originalTriangulation: originalTriangulation, // Store original vertex index mapping
      };
    });

    (geometry as any).polygonFaces = properPolygonFaces;
    (geometry as any).polygonType = polygonGeometry.type;
    (geometry as any).isProcedurallyGenerated = true;

    return geometry;
  }

  static triangulateFromCenter(face: PolygonFace): THREE.Vector3[] {
    const vertices = face.vertices;
    const triangulated: THREE.Vector3[] = [];

    if (vertices.length < 3) return triangulated;

    // Calculate center point
    const center = new THREE.Vector3();
    vertices.forEach((v) => center.add(v));
    center.divideScalar(vertices.length);

    // Create triangles from center to each edge
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      triangulated.push(center, vertices[i], vertices[next]);
    }

    return triangulated;
  }

  static triangulateFace(face: PolygonFace): THREE.Vector3[] {
    const vertices = face.vertices;
    const triangulated: THREE.Vector3[] = [];

    if (vertices.length === 3) {
      triangulated.push(...vertices);
    } else if (vertices.length === 4) {
      triangulated.push(vertices[0], vertices[1], vertices[2]);
      triangulated.push(vertices[0], vertices[2], vertices[3]);
    } else {
      // Fan triangulation for complex polygons
      for (let i = 1; i < vertices.length - 1; i++) {
        triangulated.push(vertices[0], vertices[i], vertices[i + 1]);
      }
    }

    return triangulated;
  }
}

interface PolygonFace {
  vertices: THREE.Vector3[];
  faceType: "triangle" | "quad" | "polygon";
  normal: THREE.Vector3;
}

interface PolygonGeometry {
  vertices: THREE.Vector3[];
  faces: PolygonFace[];
  type: string;
}

interface FaceInfo {
  type: "triangle" | "quad" | "polygon";
  startVertex: number;
  endVertex: number;
  originalVertices: THREE.Vector3[];
  normal: THREE.Vector3;
}
