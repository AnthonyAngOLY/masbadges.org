import { Link } from 'react-router-dom';
import { LEVELS } from '../data/levels';
import EditableText from '../components/EditableText';

// "What's assessed" — the headline criteria per level, condensed from the
// official 7-Level Syllabus assessment criteria.
const CRITERIA: Record<number, string[]> = {
  1: ['Enter and exit the pool safely', 'Ten submerged exhale-and-inhale repetitions (bobbing)', 'Front and back float, ten seconds each', 'Streamlined flutter kick for 3 m', 'Back push-and-glide for 2 m', 'Lateral rotation, front-to-back and back-to-front'],
  2: ['Fall in, turn, and grab the wall', 'Front crawl arms with flutter kick, 5 m', 'Back flutter kick, 5 m', 'Backstroke arms with kick, 5 m', 'Reach-and-pull with breath, 5 m'],
  3: ['Front crawl with unilateral breathing, 10 m', 'Backstroke, 10 m', 'Streamlined underwater push-and-glide, 3 m', 'Tread water for 30 seconds'],
  4: ['Front crawl with bilateral breathing, 15 m', 'Backstroke, 15 m', 'Breaststroke whip kick, 10 m', 'Sit dive with 3 m underwater glide', 'Survival backstroke, 10 m'],
  5: ['Front crawl, 25 m', 'Backstroke, 25 m', 'Breaststroke, 25 m', 'Dolphin kick, 10 m', 'Sculling with kick and breathing, 15 m', 'Forward and backward flip turns', 'Squat dive with 5 m dolphin kick'],
  6: ['Front crawl, 50 m', 'Backstroke, 50 m', 'Breaststroke with pullout, 50 m', 'Butterfly, 10 m', 'Tumble turn and open turn at the wall', 'Standing dive with 5 m dolphin kick', 'Sidestroke, 15 m'],
  7: ['Front crawl, 100 m under 2:30', 'Backstroke, 100 m', 'Breaststroke with pullout, 100 m', 'Butterfly, 50 m', 'Tumble and open turns', 'Standing and backstroke dives into swim', 'Individual medley, 100 m under 3:00'],
};

export default function TheProgramme() {
  return (
    <section className="mas-page mas-programme">
      <header className="mas-page-head">
        <p className="mas-eyebrow"><EditableText keyName="programme.header.eyebrow">The programme</EditableText></p>
        <h1><EditableText keyName="programme.header.title">Seven badges, one national pathway</EditableText></h1>
        <p className="mas-lede">
          <EditableText keyName="programme.header.lede">
            The MAS Swim Badges programme takes a child from their very first day in
            the water through to competitive readiness — a clear, standardised pathway
            with the same meaning at every recognised centre in the country.
          </EditableText>
        </p>
      </header>

      <div className="mas-prog-levels">
        {LEVELS.map((l) => (
          <article key={l.key} id={`level-${l.level}`} className="mas-prog-level" style={{ ['--lvl' as string]: l.color }}>
            <div className="mas-prog-level-side">
              <img src={l.badge} alt={`${l.name} badge`} loading="lazy" />
              <span className="mas-prog-level-no">Level {l.level}</span>
            </div>
            <div className="mas-prog-level-body">
              <h2>{l.name}</h2>
              <p className="mas-prog-outcome">{l.outcome}</p>
              <p className="mas-prog-assessed-label">What’s assessed</p>
              <ul className="mas-prog-criteria">
                {CRITERIA[l.level].map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className="mas-prog-info">
        <section className="mas-prog-info-card">
          <h2><EditableText keyName="programme.assessment.title">How assessment works</EditableText></h2>
          <p>
            <EditableText keyName="programme.assessment.body">
              A child is prepared by their instructor, then assessed by an independent
              examiner with no conflict of interest with the candidate. On a pass, a
              certificate is issued with a unique serial that anyone can verify online.
              The badge certifies the swimmer — the same standard wherever it is earned —
              and progression follows the pathway in order, without skipping levels.
            </EditableText>
          </p>
          <Link to="/guides/assessment" className="mas-link">Read the full assessment guide →</Link>
        </section>
        <section className="mas-prog-info-card">
          <h2><EditableText keyName="programme.fees.title">Fees</EditableText></h2>
          <p><EditableText keyName="programme.fees.intro">Assessment fees are set nationally, per level:</EditableText></p>
          <ul className="mas-prog-criteria">
            <li><strong>RM 50 per level</strong> — Starfish, Sea Turtle, Guppy</li>
            <li><strong>RM 75 per level</strong> — Octopus, Frog, Swordfish, Dolphin</li>
          </ul>
          <p><EditableText keyName="programme.fees.note">Centres set their own tuition separately.</EditableText></p>
        </section>
      </div>

      <div className="mas-prog-cta">
        <Link className="mas-btn-solid-navy" to="/find-a-centre">Find a recognised centre</Link>
        <Link className="mas-btn-ghost-navy" to="/guides/how-it-works">How the programme works</Link>
      </div>
    </section>
  );
}
