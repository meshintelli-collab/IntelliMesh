import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Heart } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

export default function About() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 text-white">
      {/* Header with Back Button */}
      <header className="relative z-10 p-6">
        <Link to="/">
          <Button
            variant="outline"
            className="bg-white/10 border-white/20 text-white hover:bg-white/20"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Intellimesh
          </Button>
        </Link>
      </header>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-6 pb-12">
        {/* Main About Card */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm mb-8">
          <CardContent className="p-8">
            <h1 className="text-4xl font-bold mb-6 text-center">
              About Intellimesh
            </h1>

            <div className="text-lg leading-relaxed space-y-4 text-gray-300">
              <p>
                Intellimesh is a&nbsp; for 3D mesh manipulation and fabrication.
                Built for designers, engineers, tinkerers, and 3D enthusiasts
                worldwide.
              </p>

              <p>
                We want to provide you with powerful tools for analyzing,
                optimizing, and fabricating 3D models with precision and
                professional-grade results.
                <br />
              </p>

              <p>
                Whether you're prototyping, manufacturing, or exploring 3D
                design, we&nbsp; are trying to make complex mesh operations
                simple and accessible.
                <br />
              </p>
            </div>
          </CardContent>
        </Card>

        {/* What can I do here? Section */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm mb-8">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-4 text-center">
              What can I do here?
            </h2>

            <div className="text-lg leading-relaxed text-gray-300">
              <p className="mb-4">
                With the current form of the website you should be able to:
              </p>
              <ul className="space-y-3 ml-4">
                <li className="flex items-start">
                  <span className="text-blue-400 mr-3 text-xl">•</span>
                  <span>Load your own models (or choose one of ours)</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-400 mr-3 text-xl">•</span>
                  <span>View and play around with it a bit</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-400 mr-3 text-xl">•</span>
                  <span>Perform mesh simplification steps</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-400 mr-3 text-xl">•</span>
                  <span>
                    Export your simplified model as a whole, or all of its
                    separate parts (so you can laser cut and weld, 3D print and
                    glue, or whatever!)
                  </span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm mb-8">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <Mail className="w-6 h-6 mr-3" />
              Contact Us
            </h2>

            <div className="space-y-3 text-gray-300">
              <div className="flex items-center">
                <span className="font-medium w-32">General:</span>
                <span className="text-white">meshintelli@gmail.com</span>
              </div>
              <div className="flex items-center">
                <span className="font-medium w-32">Support:</span>
                <span className="text-white">meshintelli@gmail.com</span>
              </div>
              <div className="flex items-center">
                <span className="font-medium w-32">Features:</span>
                <span className="text-white">meshintelli@gmail.com</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Donate Information */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <Heart className="w-6 h-6 mr-3 text-red-500" />
              Support Our Work
            </h2>

            <div className="mb-6 text-gray-300">
              <p className="mb-4">
                Intellimesh is a passion project built by some guys who, whilst
                they are terrified of women, want to make 3D computational
                geometry tools accessible to everyone. Your support helps us
                maintain the platform, add new features, and keep it free for
                the community.
              </p>
            </div>

            <div className="text-center mb-4">
              <span className="text-gray-500 font-medium">Coming Soon</span>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                disabled
                className="bg-gray-400 text-white cursor-not-allowed opacity-50"
              >
                <Heart className="w-4 h-4 mr-2" />
                Donate via PayPal
              </Button>
              <Button
                disabled
                variant="outline"
                className="border-gray-300 text-gray-400 cursor-not-allowed opacity-50"
              >
                Support on Ko-fi
              </Button>
              <Button
                disabled
                variant="outline"
                className="border-gray-300 text-gray-400 cursor-not-allowed opacity-50"
              >
                GitHub Sponsors
              </Button>
            </div>

            <p className="text-sm opacity-75 mt-4">
              All donations go directly to platform development and hosting
              costs. ❤️
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
