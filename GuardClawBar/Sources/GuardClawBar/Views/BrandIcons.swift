import SwiftUI

/// Monochrome brand icons loaded from bundled PNG resources
struct BrandIcon: View {
    let provider: String
    let size: CGFloat

    init(_ provider: String, size: CGFloat = 14) {
        self.provider = provider
        self.size = size
    }

    private var imageName: String {
        switch provider {
        case "claude-code": return "claude-logo"
        case "openclaw": return "openclaw-logo"
        case "gemini-cli": return "gemini-logo"
        case "cursor": return "cursor-logo"
        case "opencode": return "opencode-logo"
        default: return ""
        }
    }

    var body: some View {
        Group {
            if let url = Bundle.module.url(forResource: imageName, withExtension: "png"),
               let nsImage = NSImage(contentsOf: url) {
                Image(nsImage: nsImage)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "questionmark.circle")
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: size, height: size)
    }
}
