// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GuardClawBar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "GuardClawBar",
            path: "Sources/GuardClawBar"
        )
    ]
)
