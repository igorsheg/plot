// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Plot",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/pointfreeco/swift-composable-architecture", from: "1.17.0"),
        .package(url: "https://github.com/jpsim/Yams", from: "5.1.0"),
    ],
    targets: [
        .executableTarget(
            name: "Plot",
            dependencies: [
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
                .product(name: "Yams", package: "Yams"),
            ],
            path: "Plot",
            exclude: ["Resources/Assets.xcassets", "Plot.entitlements"],
            resources: []
        ),
    ]
)
