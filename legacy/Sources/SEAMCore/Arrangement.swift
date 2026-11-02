import Foundation

/// A non-destructive view onto a source file with trim offsets and edge fades.
public struct Clip: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var title: String
    public var sourceDuration: TimeInterval
    public var trimStart: TimeInterval
    public var trimEnd: TimeInterval
    public var fadeIn: TimeInterval
    public var fadeOut: TimeInterval

    public init(id: UUID = UUID(), title: String, sourceDuration: TimeInterval,
                trimStart: TimeInterval = 0, trimEnd: TimeInterval? = nil,
                fadeIn: TimeInterval = 0, fadeOut: TimeInterval = 0) {
        self.id = id
        self.title = title
        self.sourceDuration = max(sourceDuration, 0)
        let end = min(max(trimEnd ?? sourceDuration, 0), self.sourceDuration)
        self.trimStart = min(max(trimStart, 0), end)
        self.trimEnd = end
        self.fadeIn = min(max(fadeIn, 0), end - self.trimStart)
        self.fadeOut = min(max(fadeOut, 0), end - self.trimStart)
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, sourceDuration, trimStart, trimEnd, fadeIn, fadeOut
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try values.decode(UUID.self, forKey: .id),
            title: try values.decode(String.self, forKey: .title),
            sourceDuration: try values.decode(TimeInterval.self, forKey: .sourceDuration),
            trimStart: try values.decode(TimeInterval.self, forKey: .trimStart),
            trimEnd: try values.decode(TimeInterval.self, forKey: .trimEnd),
            fadeIn: try values.decodeIfPresent(TimeInterval.self, forKey: .fadeIn) ?? 0,
            fadeOut: try values.decodeIfPresent(TimeInterval.self, forKey: .fadeOut) ?? 0
        )
    }

    public var playableDuration: TimeInterval { trimEnd - trimStart }
}

public struct PlacedClip: Equatable, Sendable {
    public let clip: Clip
    /// Start position on the arrangement timeline.
    public let start: TimeInterval
    /// Overlap with the previous clip (0 for the first clip or a gapless cut).
    public let overlapIn: TimeInterval
    public let curveIn: FadeCurve
    public var end: TimeInterval { start + clip.playableDuration }
}

/// An ordered EP/album. `transitions[i]` joins `clips[i]` into `clips[i+1]`.
public struct Arrangement: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var clips: [Clip]
    public var transitions: [TransitionSettings]

    public init(id: UUID = UUID(), name: String, clips: [Clip] = [],
                transitions: [TransitionSettings] = []) {
        self.id = id
        self.name = name
        self.clips = clips
        self.transitions = transitions
        normalize()
    }

    /// Keeps `transitions.count == max(clips.count - 1, 0)`.
    public mutating func normalize() {
        let needed = max(clips.count - 1, 0)
        if transitions.count > needed { transitions.removeLast(transitions.count - needed) }
        while transitions.count < needed { transitions.append(TransitionSettings()) }
    }

    public mutating func append(_ clip: Clip) {
        clips.append(clip)
        normalize()
    }

    /// Reorders a clip; adjacent transitions reset to defaults because they described different pairs.
    public mutating func move(from: Int, to: Int) {
        guard clips.indices.contains(from), clips.indices.contains(to), from != to else { return }
        let clip = clips.remove(at: from)
        clips.insert(clip, at: to)
        transitions = Array(repeating: TransitionSettings(), count: max(clips.count - 1, 0))
    }

    /// Effective overlap is clamped so it never exceeds either neighbouring clip.
    public func effectiveOverlap(at index: Int) -> TimeInterval {
        guard transitions.indices.contains(index), clips.indices.contains(index + 1) else { return 0 }
        return min(transitions[index].duration,
                   clips[index].playableDuration,
                   clips[index + 1].playableDuration)
    }

    public func timeline() -> [PlacedClip] {
        var placed: [PlacedClip] = []
        var cursor: TimeInterval = 0
        for (i, clip) in clips.enumerated() {
            let overlap = i == 0 ? 0 : effectiveOverlap(at: i - 1)
            let start = cursor - overlap
            placed.append(PlacedClip(clip: clip, start: start, overlapIn: overlap,
                                     curveIn: i == 0 ? .linear : transitions[i - 1].curve))
            cursor = start + clip.playableDuration
        }
        return placed
    }

    public var totalDuration: TimeInterval { timeline().last?.end ?? 0 }

    /// Plain-text tracklist with start times and transition settings.
    public func tracklistText() -> String {
        var lines = [name, String(repeating: "-", count: max(name.count, 3))]
        for (i, p) in timeline().enumerated() {
            lines.append("\(i + 1). \(Self.format(p.start))  \(p.clip.title)  (\(Self.format(p.clip.playableDuration)))")
            if i + 1 < clips.count {
                let t = transitions[i]
                let eff = effectiveOverlap(at: i)
                let kind = eff == 0 ? "gapless cut" : String(format: "%.2fs %@ crossfade", eff, t.curve.rawValue)
                lines.append("     -> \(kind)")
            }
        }
        lines.append("Total: \(Self.format(totalDuration))")
        return lines.joined(separator: "\n")
    }

    static func format(_ t: TimeInterval) -> String {
        let s = Int(t.rounded(.down))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
