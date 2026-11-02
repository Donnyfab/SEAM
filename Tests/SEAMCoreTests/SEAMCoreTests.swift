import Testing
import Foundation
@testable import SEAMCore

@Suite struct CrossfadeTests {
    @Test func equalPowerKeepsConstantPower() {
        for t in stride(from: 0.0, through: 1.0, by: 0.1) {
            let g = FadeCurve.equalPower.gains(at: t)
            #expect(abs(g.out * g.out + g.in * g.in - 1) < 1e-9)
        }
    }
    @Test func durationClampedTo15s() {
        #expect(TransitionSettings(duration: 40).duration == 15)
        #expect(TransitionSettings(duration: -2).duration == 0)
    }
}

@Suite struct ArrangementTests {
    func make() -> Arrangement {
        var a = Arrangement(name: "EP")
        a.append(Clip(title: "A", sourceDuration: 100))
        a.append(Clip(title: "B", sourceDuration: 80))
        a.append(Clip(title: "C", sourceDuration: 60))
        return a
    }
    @Test func transitionsTrackClipCount() {
        #expect(make().transitions.count == 2)
    }
    @Test func gaplessTimelineHasNoOverlap() {
        let t = make().timeline()
        #expect(t[1].start == 100 && t[2].start == 180)
    }
    @Test func crossfadeOverlapsTimeline() {
        var a = make()
        a.transitions[0] = TransitionSettings(duration: 8)
        let t = a.timeline()
        #expect(t[1].start == 92)
        #expect(a.totalDuration == 232)
        #expect(t[2].start == 172)
    }
    @Test func overlapClampedToShortClip() {
        var a = Arrangement(name: "x")
        a.append(Clip(title: "long", sourceDuration: 100))
        a.append(Clip(title: "tiny", sourceDuration: 3))
        a.transitions[0] = TransitionSettings(duration: 12)
        #expect(a.effectiveOverlap(at: 0) == 3)
    }
    @Test func trimIsNonDestructiveAndShortensClip() {
        let c = Clip(title: "T", sourceDuration: 100, trimStart: 10, trimEnd: 90)
        #expect(c.playableDuration == 80 && c.sourceDuration == 100)
    }
    @Test func trimClampedToSource() {
        let c = Clip(title: "T", sourceDuration: 50, trimStart: -5, trimEnd: 999)
        #expect(c.trimStart == 0 && c.trimEnd == 50)
    }
    @Test func reorderResetsTransitions() {
        var a = make()
        a.transitions[0] = TransitionSettings(duration: 5)
        a.move(from: 2, to: 0)
        #expect(a.clips.map(\.title) == ["C", "A", "B"])
        #expect(a.transitions.allSatisfy { $0.duration == 0 })
    }
    @Test func codableRoundTrip() throws {
        let a = make()
        let data = try JSONEncoder().encode(a)
        #expect(try JSONDecoder().decode(Arrangement.self, from: data) == a)
    }
    @Test func tracklistMentionsTransitions() {
        var a = make()
        a.transitions[1] = TransitionSettings(duration: 4)
        let text = a.tracklistText()
        #expect(text.contains("gapless cut") && text.contains("4.00s equalPower crossfade"))
    }
}

@Suite struct PlayQueueTests {
    @Test func repeatOneOnAutoAdvance() {
        var q = PlayQueue(items: [1, 2, 3], startIndex: 1)
        q.repeatMode = .one
        #expect(q.advance(auto: true) == 2)
        #expect(q.advance(auto: false) == 3)
    }
    @Test func repeatAllWraps() {
        var q = PlayQueue(items: [1, 2], startIndex: 1)
        q.repeatMode = .all
        #expect(q.advance(auto: true) == 1)
    }
    @Test func endsWithoutRepeat() {
        var q = PlayQueue(items: [1], startIndex: 0)
        #expect(q.advance(auto: true) == nil)
    }
    @Test func moveKeepsCurrentTrackTracked() {
        var q = PlayQueue(items: ["a", "b", "c", "d"], startIndex: 1)
        q.move(from: 3, to: 0)
        #expect(q.current == "b")
        q.move(from: 0, to: 3)
        #expect(q.current == "b")
    }
    @Test func shuffleKeepsCurrentFirst() {
        var q = PlayQueue(items: Array(1...20), startIndex: 4)
        var rng = SystemRandomNumberGenerator()
        q.shuffleUpcoming(using: &rng)
        #expect(q.current == 5 && Set(q.items) == Set(1...20))
    }
}
