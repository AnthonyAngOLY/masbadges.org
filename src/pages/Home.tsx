import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LEVELS } from '../data/levels';
import EditableText from '../components/EditableText';

const ROLES = [
  { title: 'Chairperson', body: 'Leads the programme and is accountable for its governance and direction.' },
  { title: 'Chief Examiner', body: 'Owns the assessment standard — examiner certification, audits, and the integrity of every result.' },
  { title: 'Master Trainer', body: 'Develops and delivers the instructor and examiner certification courses.' },
  { title: 'Coaching & Technical Board', body: 'Governs the syllabus and technical standards, with the MAS Board ratifying major decisions.' },
];

const TRUST = [
  { lvl: '#1D87E4', mark: '⇄', title: 'Independent assessment', body: 'A firewall between teaching and judging — an examiner never assesses a swimmer they taught.' },
  { lvl: '#26A59A', mark: '①', title: 'One national standard', body: 'The same seven-level syllabus and criteria at every recognised centre in the country.' },
  { lvl: '#FF7042', mark: '✓', title: 'Verifiable certificates', body: 'Serialised, issued only on a genuine pass, and publicly verifiable — without exposing a child’s identity.' },
];

const SLIDE_COUNT = 3;
const AUTOPLAY_MS = 7000;

const HERO_CSS = `
.mas-hero-carousel {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  margin-bottom: 2.75rem;
  background: transparent;
  padding: 0;
}
.mas-hero-track {
  display: grid;
  grid-template-columns: repeat(3, 100%);
  transition: transform 600ms cubic-bezier(0.22, 0.9, 0.3, 1);
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .mas-hero-track { transition: none; }
}
.mas-hero-slide {
  position: relative;
  background:
    radial-gradient(120% 140% at 85% 10%, rgba(255,255,255,.18), transparent 55%),
    linear-gradient(135deg, var(--mas-teal, #26A59A) 0%, var(--mas-teal-deep, #148578) 100%);
  color: #fff;
  padding: clamp(0.75rem, 3vw, 2rem) clamp(2.25rem, 5vw, 3.5rem);
  overflow: hidden;
  min-height: clamp(16.9rem, 38vw, 24.9rem);
}
.mas-hero-slide--variant-b {
  background:
    radial-gradient(120% 140% at 15% 10%, rgba(255,255,255,.20), transparent 55%),
    linear-gradient(135deg, #1E2752 0%, #2b3a7a 100%);
}
.mas-hero-slide--variant-c {
  background:
    radial-gradient(120% 140% at 50% 0%, rgba(255,255,255,.20), transparent 60%),
    linear-gradient(135deg, #C62026 0%, #8a1418 100%);
}
.mas-hero-slide-grid {
  position: relative; z-index: 2;
  display: grid;
  grid-template-columns: 1fr min(58%, 38rem);
  gap: clamp(1.5rem, 4vw, 3rem);
  align-items: end;
  max-width: 1180px;
  margin: 0 auto;
}
.mas-hero-slide--no-media .mas-hero-slide-grid { grid-template-columns: 1fr; }
.mas-hero-copy { max-width: 640px; align-self: center; }
.mas-hero-media {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: visible;
}
.mas-hero-media img {
  width: 100%;
  max-width: 41rem;
  height: auto;
  display: block;
  margin-bottom: clamp(-4rem, -6vw, -2rem);
  filter: drop-shadow(0 18px 32px rgba(0,0,0,0.28));
  animation: mas-hero-float 5.5s ease-in-out infinite;
}
@keyframes mas-hero-float {
  0%,   100% { transform: translateY(0); }
  50%        { transform: translateY(-8px); }
}
@media (prefers-reduced-motion: reduce) {
  .mas-hero-media img { animation: none; }
}
@media (max-width: 720px) {
  .mas-hero-slide-grid { grid-template-columns: 1fr; }
  .mas-hero-media { display: none; }
}
.mas-hero-nav {
  position: absolute;
  bottom: 1.1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  gap: 0.55rem;
  align-items: center;
}
.mas-hero-dot {
  width: 0.6rem; height: 0.6rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.4);
  border: 0; padding: 0; cursor: pointer;
  transition: background 200ms ease, transform 200ms ease;
}
.mas-hero-dot:hover, .mas-hero-dot:focus-visible {
  background: rgba(255,255,255,0.7);
  outline: none;
}
.mas-hero-dot.is-active {
  background: #fff;
  transform: scale(1.35);
}
.mas-hero-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  width: 2.5rem; height: 2.5rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.25);
  color: #fff;
  font-size: 1.2rem;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 200ms ease;
}
.mas-hero-arrow:hover, .mas-hero-arrow:focus-visible {
  background: rgba(255,255,255,0.3);
  outline: none;
}
.mas-hero-arrow--prev { left: 1rem; }
.mas-hero-arrow--next { right: 1rem; }
@media (max-width: 720px) { .mas-hero-arrow { display: none; } }
`;

interface HeroSlideProps {
  variant?: 'a' | 'b' | 'c';
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  cta: React.ReactNode;
  mediaSrc?: string;
  mediaAlt?: string;
  ariaLabel: string;
}
function HeroSlide({ variant = 'a', eyebrow, title, subtitle, cta, mediaSrc, mediaAlt, ariaLabel }: HeroSlideProps) {
  const variantClass = variant === 'b' ? 'mas-hero-slide--variant-b' : variant === 'c' ? 'mas-hero-slide--variant-c' : '';
  const noMediaClass = mediaSrc ? '' : 'mas-hero-slide--no-media';
  return (
    <div
      className={`mas-hero-slide ${variantClass} ${noMediaClass}`.trim()}
      role="group"
      aria-roledescription="slide"
      aria-label={ariaLabel}
    >
      <span className="mas-hero-halftone" aria-hidden="true" />
      <svg className="mas-hero-waves" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden="true">
        <g fill="none" stroke="#ffffff" strokeWidth="2">
          <path d="M0 150 C 200 110 360 200 560 160 S 980 110 1200 160" strokeOpacity="0.16" />
          <path d="M0 190 C 220 150 380 240 600 200 S 1000 150 1200 200" strokeOpacity="0.12" />
          <path d="M0 110 C 180 80 380 150 600 110 S 1020 60 1200 110" strokeOpacity="0.10" />
        </g>
      </svg>
      <div className="mas-hero-slide-grid">
        <div className="mas-hero-copy">
          <p className="mas-eyebrow-pill">{eyebrow}</p>
          <h1 className="mas-home-title">{title}</h1>
          <p className="mas-home-sub">{subtitle}</p>
          <div className="mas-home-cta">{cta}</div>
        </div>
        {mediaSrc && (
          <div className="mas-hero-media">
            <img src={mediaSrc} alt={mediaAlt ?? ''} loading="eager" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <section className="mas-page mas-home">
      <HeroCarousel />

      <section className="mas-levels">
        <div className="mas-levels-head">
          <h2><EditableText keyName="home.levels.title">Seven levels</EditableText></h2>
          <span className="mas-levels-arrow">Starfish → Dolphin</span>
        </div>
        <div className="mas-levelstrip">
          {LEVELS.map((l) => (
            <Link
              key={l.key}
              className="mas-levelcard"
              to={`/the-programme#level-${l.level}`}
              style={{ ['--lvl' as string]: l.color }}
              aria-label={`Level ${l.level}: ${l.name} — see details on The Programme page`}
            >
              <div className="mas-levelcard-badge">
                <img src={l.badge} alt={`${l.name} badge`} loading="lazy" />
              </div>
              <span className="mas-levelcard-no">Level {l.level}</span>
              <span className="mas-levelcard-name">{l.name}</span>
              <p className="mas-levelcard-blurb">{l.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mas-home-teasers" aria-label="Explore the programme">
        <article className="mas-teaser">
          <span className="mas-eyebrow">How it works</span>
          <h2>
            <EditableText keyName="home.teaser.howitworks.title">From first splash to finish line</EditableText>
          </h2>
          <p>
            <EditableText keyName="home.teaser.howitworks.body">
              Seven levels take a child from water familiarisation to competitive readiness — each one a clear, assessed step with a badge to show for it. No guesswork, just steady progress.
            </EditableText>
          </p>
          <Link to="/the-programme" className="mas-btn-solid-navy">See the programme</Link>
        </article>

        <article className="mas-teaser">
          <span className="mas-eyebrow">Find a centre near you</span>
          <h2>
            <EditableText keyName="home.teaser.findcentre.title">Learn at a centre you can trust</EditableText>
          </h2>
          <p>
            <EditableText keyName="home.teaser.findcentre.body">
              BADGES is taught at partner centres across Malaysia, each one accredited to the national standard. Find one near you and enrol your child.
            </EditableText>
          </p>
          <Link to="/find-a-centre" className="mas-btn-solid-navy">Find a swim centre</Link>
        </article>

        <article className="mas-teaser">
          <span className="mas-eyebrow">Teach with BADGES</span>
          <h2>
            <EditableText keyName="home.teaser.teach.title">Bring BADGES to your centre</EditableText>
          </h2>
          <p>
            Become an accredited instructor or partner centre and deliver a
            structured national curriculum, backed by a full teaching and
            assessment system.
          </p>
          <Link to="/courses" className="mas-btn-solid-navy">Explore courses</Link>
        </article>

        <article className="mas-teaser">
          <span className="mas-eyebrow">Keep levelling up</span>
          <h2>
            <EditableText keyName="home.teaser.levelup.title">Every level is a reason to keep going</EditableText>
          </h2>
          <p>
            Each badge marks real, assessed progress — a milestone a child can
            see and be proud of, and a clear next step to aim for. Good teaching
            and honest assessment keep swimmers moving from one level to the next.
          </p>
          <Link to="/guides/enrol" className="mas-btn-solid-navy">What to expect</Link>
        </article>
      </section>

      <section id="about" className="mas-home-about">
        <header className="mas-page-head mas-section-head">
          <p className="mas-eyebrow"><EditableText keyName="home.about.header.eyebrow">About</EditableText></p>
          <h2><EditableText keyName="home.about.header.title">About the programme</EditableText></h2>
          <p className="mas-lede">
            <EditableText keyName="home.about.header.lede">
              MAS Swim Badges is the national Learn-to-Swim certification framework of
              Malaysia Aquatics — built to give every Malaysian child a clear,
              standardised pathway from their first day in the water through to
              competitive readiness.
            </EditableText>
          </p>
        </header>

        <header className="mas-page-head mas-section-head"><h2><EditableText keyName="home.about.run.title">How it’s run</EditableText></h2></header>
        <p className="mas-lede">
          <EditableText keyName="home.about.run.body">
            The programme is governed by Malaysia Aquatics through its Board and its
            Coaching & Technical Board. A Chairperson leads the programme, a Chief
            Examiner oversees assessment standards, and certified Master Trainers run
            the instructor and examiner courses. Examiners are selected and deployed by
            state, and assessments are always independent of the centres being assessed.
          </EditableText>
        </p>

        <header className="mas-page-head mas-section-head"><h2><EditableText keyName="home.about.governs.title">Who governs it</EditableText></h2></header>
        <div className="mas-gov-grid">
          {ROLES.map((r) => (
            <article key={r.title} className="mas-gov-card">
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
        <p className="mas-field-note" style={{ marginTop: '0.85rem' }}>
          <EditableText keyName="home.about.governs.note">
            Office-holder names are published in the official MAS Accreditation & Badges Awards booklet.
          </EditableText>
        </p>

        <header className="mas-page-head mas-section-head"><h2><EditableText keyName="home.about.trust.title">What makes a badge trustworthy</EditableText></h2></header>
        <div className="mas-trust-grid">
          {TRUST.map((t) => (
            <article key={t.title} className="mas-trust-card" style={{ ['--lvl' as string]: t.lvl }}>
              <div className="mas-trust-ico" aria-hidden="true">{t.mark}</div>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </article>
          ))}
        </div>

        <p className="mas-home-verify-note">
          Earned a badge? <Link to="/verify">You can verify any certificate online.</Link>
        </p>

        <div className="mas-cta-band">
          <h2><EditableText keyName="home.about.cta.title">Seven badges, one national pathway</EditableText></h2>
          <p><EditableText keyName="home.about.cta.body">See how a child progresses from Starfish to Dolphin — and find a recognised centre near you.</EditableText></p>
          <div className="mas-cta-row">
            <Link className="mas-btn-solid" to="/the-programme">Explore the seven badges</Link>
            <Link className="mas-btn-outline-light" to="/contact">Contact us</Link>
          </div>
        </div>
      </section>
    </section>
  );
}

function HeroCarousel() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const goTo = useCallback((i: number) => {
    setCurrent(((i % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT);
  }, []);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);
  const next = useCallback(() => goTo(current + 1), [current, goTo]);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || paused) return;
    const id = window.setInterval(() => setCurrent((c) => (c + 1) % SLIDE_COUNT), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  }

  return (
    <div
      className="mas-hero-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured highlights"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <style>{HERO_CSS}</style>
      <div
        ref={trackRef}
        className="mas-hero-track"
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        <HeroSlide
          variant="a"
          ariaLabel="Slide 1 of 3: Learn-to-Swim Badges"
          eyebrow={<EditableText keyName="home.hero.eyebrow">Swimming Proficiency Test</EditableText>}
          title={<EditableText keyName="home.hero.title">Learn-to-Swim Badges</EditableText>}
          subtitle={
            <EditableText keyName="home.hero.subtitle">
              A skill-progression programme for swimmers aged 5–12 — from first water familiarisation through to competitive readiness, across seven levels.
            </EditableText>
          }
          cta={
            <>
              <Link to="/find-a-centre" className="mas-btn-solid">Find a swim centre</Link>
              <Link to="/verify" className="mas-btn-outline-light">Verify a certificate</Link>
            </>
          }
          mediaSrc="/hero/mascot-welcome.png"
          mediaAlt="A friendly MAS BADGES mascot in a white polo welcoming you"
        />
        <HeroSlide
          variant="b"
          ariaLabel="Slide 2 of 3: For parents and swimmers"
          eyebrow={<EditableText keyName="home.hero2.eyebrow">For parents & swimmers</EditableText>}
          title={<EditableText keyName="home.hero2.title">Seven levels. One national standard.</EditableText>}
          subtitle={
            <EditableText keyName="home.hero2.subtitle">
              Every certificate is earned against the same published criteria, wherever your child learns to swim. Verifiable, serialised, and issued only on a genuine pass.
            </EditableText>
          }
          cta={
            <>
              <Link to="/for-parents" className="mas-btn-solid">How it works for parents</Link>
              <Link to="/the-programme" className="mas-btn-outline-light">See the seven levels</Link>
            </>
          }
        />
        <HeroSlide
          variant="c"
          ariaLabel="Slide 3 of 3: For swim schools and instructors"
          eyebrow={<EditableText keyName="home.hero3.eyebrow">For swim schools & instructors</EditableText>}
          title={<EditableText keyName="home.hero3.title">Teach and assess to a recognised standard.</EditableText>}
          subtitle={
            <EditableText keyName="home.hero3.subtitle">
              Become a recognised partner centre, or get MAS BADGES certified as an instructor or examiner. Independent assessment, published criteria, national credibility.
            </EditableText>
          }
          cta={
            <>
              <Link to="/for-centres" className="mas-btn-solid">Partner your centre</Link>
              <Link to="/courses" className="mas-btn-outline-light">Certification courses</Link>
            </>
          }
        />
      </div>

      <button type="button" className="mas-hero-arrow mas-hero-arrow--prev" onClick={prev} aria-label="Previous slide">‹</button>
      <button type="button" className="mas-hero-arrow mas-hero-arrow--next" onClick={next} aria-label="Next slide">›</button>

      <div className="mas-hero-nav" role="tablist" aria-label="Choose a slide">
        {Array.from({ length: SLIDE_COUNT }, (_, i) => (
          <button
            key={i}
            role="tab"
            type="button"
            className={`mas-hero-dot${i === current ? ' is-active' : ''}`}
            aria-label={`Go to slide ${i + 1}`}
            aria-selected={i === current}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}
