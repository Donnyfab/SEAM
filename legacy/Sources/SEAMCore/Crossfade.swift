import Foundation

/// Gain curve applied across a transition overlap.
public enum FadeCurve: String, Codable, Sendable, CaseIterable {
    case linear
    case equalPower

    /// Gains for the outgoing and incoming track at progress `t` in 0...1.
    public func gains(at t: Double) -> (out: Double, in: Double) {
        let p = min(max(t, 0), 1)
        switch self {
        case .linear:
            return (1 - p, p)
        case .equalPower:
            return (cos(p * .pi / 2), sin(p * .pi / 2))
        }
    }
}

/// Per-transition settings. `duration == 0` is a true gapless cut.
public struct TransitionSettings: Codable, Equatable, Sendable {
    public static let maxDuration: TimeInterval = 15

    public var duration: TimeInterval
    public var curve: FadeCurve

    public init(duration: TimeInterval = 0, curve: FadeCurve = .equalPower) {
        self.duration = min(max(duration, 0), Self.maxDuration)
        self.curve = curve
    }
}
