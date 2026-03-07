import AppKit
import CoreGraphics

enum IconStatus {
    case normal      // green dot — agent(s) connected
    case idle        // gray dot — server up, no agents
    case pending     // yellow dot + badge
    case error       // red dot — server down
}

enum IconRenderer {
    /// Renders the GuardClaw shield+paw icon at 18x18pt with a status dot.
    static func render(status: IconStatus, badgeCount: Int) -> NSImage {
        let size = NSSize(width: 22, height: 22)
        let image = NSImage(size: size, flipped: false) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }

            // Draw shield+paw centered in an 18x18 area (with 2pt padding)
            let iconRect = CGRect(x: 2, y: 2, width: 18, height: 18)
            drawShield(in: ctx, rect: iconRect)
            drawPaw(in: ctx, rect: iconRect)

            // Badge number for pending approvals only
            if status == .pending && badgeCount > 0 {
                drawBadge(in: ctx, rect: rect, count: badgeCount)
            }

            return true
        }
        image.isTemplate = false
        return image
    }

    // MARK: - Shield

    private static func drawShield(in ctx: CGContext, rect: CGRect) {
        // Original viewBox: 0 0 128 128, shield path:
        // M64 8 L112 28 V64 C112 96 88 116 64 124 C40 116 16 96 16 64 V28 Z
        let sx = rect.width / 128.0
        let sy = rect.height / 128.0
        let ox = rect.origin.x
        let oy = rect.origin.y

        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: ox + x * sx, y: oy + (128 - y) * sy)
        }

        let shieldPath = CGMutablePath()
        shieldPath.move(to: p(64, 8))
        shieldPath.addLine(to: p(112, 28))
        shieldPath.addLine(to: p(112, 64))
        shieldPath.addCurve(to: p(64, 124), control1: p(112, 96), control2: p(88, 116))
        shieldPath.addCurve(to: p(16, 64), control1: p(40, 116), control2: p(16, 96))
        shieldPath.addLine(to: p(16, 28))
        shieldPath.closeSubpath()

        // Blue-purple gradient
        ctx.saveGState()
        ctx.addPath(shieldPath)
        ctx.clip()

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let colors = [
            CGColor(red: 0.231, green: 0.510, blue: 0.965, alpha: 1.0), // #3b82f6
            CGColor(red: 0.545, green: 0.361, blue: 0.965, alpha: 1.0), // #8b5cf6
        ] as CFArray
        if let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0, 1]) {
            ctx.drawLinearGradient(
                gradient,
                start: CGPoint(x: rect.minX, y: rect.maxY),
                end: CGPoint(x: rect.maxX, y: rect.minY),
                options: []
            )
        }
        ctx.restoreGState()
    }

    // MARK: - Paw

    private static func drawPaw(in ctx: CGContext, rect: CGRect) {
        let sx = rect.width / 128.0
        let sy = rect.height / 128.0
        let ox = rect.origin.x
        let oy = rect.origin.y

        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.95))

        // Center pad: ellipse cx=64 cy=76 rx=14 ry=12
        drawEllipse(in: ctx, cx: ox + 64*sx, cy: oy + (128-76)*sy, rx: 14*sx, ry: 12*sy)

        // Toe pads
        drawEllipse(in: ctx, cx: ox + 44*sx, cy: oy + (128-56)*sy, rx: 9*sx, ry: 8*sy)
        drawEllipse(in: ctx, cx: ox + 64*sx, cy: oy + (128-48)*sy, rx: 9*sx, ry: 8*sy)
        drawEllipse(in: ctx, cx: ox + 84*sx, cy: oy + (128-56)*sy, rx: 9*sx, ry: 8*sy)
    }

    private static func drawEllipse(in ctx: CGContext, cx: CGFloat, cy: CGFloat, rx: CGFloat, ry: CGFloat) {
        let rect = CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2)
        ctx.fillEllipse(in: rect)
    }

    // MARK: - Status Dot

    private static func drawStatusDot(in ctx: CGContext, rect: CGRect, status: IconStatus) {
        let color: CGColor
        switch status {
        case .normal:
            color = CGColor(red: 0.22, green: 0.78, blue: 0.35, alpha: 1.0) // green
        case .idle:
            color = CGColor(red: 0.60, green: 0.60, blue: 0.60, alpha: 1.0) // gray
        case .pending:
            color = CGColor(red: 1.0, green: 0.76, blue: 0.03, alpha: 1.0) // yellow
        case .error:
            color = CGColor(red: 0.94, green: 0.27, blue: 0.27, alpha: 1.0) // red
        }

        // White border
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fillEllipse(in: rect.insetBy(dx: -1, dy: -1))

        ctx.setFillColor(color)
        ctx.fillEllipse(in: rect)
    }

    // MARK: - Badge

    private static func drawBadge(in ctx: CGContext, rect: CGRect, count: Int) {
        let text = count > 9 ? "9+" : "\(count)"
        let font = NSFont.systemFont(ofSize: 8, weight: .bold)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.white,
        ]
        let str = NSAttributedString(string: text, attributes: attrs)
        let strSize = str.size()

        let badgeWidth = max(strSize.width + 4, 10)
        let badgeHeight: CGFloat = 10
        let badgeRect = CGRect(
            x: rect.maxX - badgeWidth,
            y: rect.maxY - badgeHeight,
            width: badgeWidth,
            height: badgeHeight
        )

        // Red badge background
        ctx.setFillColor(CGColor(red: 0.94, green: 0.27, blue: 0.27, alpha: 1.0))
        let badgePath = CGPath(roundedRect: badgeRect, cornerWidth: 5, cornerHeight: 5, transform: nil)
        ctx.addPath(badgePath)
        ctx.fillPath()

        // Draw text
        let textRect = CGRect(
            x: badgeRect.midX - strSize.width / 2,
            y: badgeRect.midY - strSize.height / 2,
            width: strSize.width,
            height: strSize.height
        )
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
        str.draw(in: CGRect(
            x: textRect.origin.x,
            y: rect.height - textRect.origin.y - textRect.height,
            width: textRect.width,
            height: textRect.height
        ))
        NSGraphicsContext.restoreGraphicsState()
    }
}
