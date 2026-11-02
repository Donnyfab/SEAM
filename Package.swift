// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "SEAM",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "SEAMCore", targets: ["SEAMCore"])],
    targets: [
        .target(name: "SEAMCore"),
        .testTarget(name: "SEAMCoreTests", dependencies: ["SEAMCore"]),
    ]
)
