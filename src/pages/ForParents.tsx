import { Link } from 'react-router-dom';
import '../styles/admin.css';

export default function ForParents() {
  return (
    <section className="mas-page">
      <header className="mas-page-head">
        <p className="mas-eyebrow">For parents</p>
        <h1>A national standard you can trust</h1>
        <p className="mas-lede">
          The MAS Swim Badges programme gives your child a clear, step-by-step
          path in the water — and a badge that means the same thing at every
          recognised centre in Malaysia.
        </p>
      </header>

      <header className="mas-page-head mas-section-head"><h2>What a badge means</h2></header>
      <p className="mas-lede">
        Each badge — from Starfish through Dolphin — marks a defined set of skills.
        Your child is prepared by their instructor and then assessed by an
        independent examiner, so the badge reflects a genuinely met standard, not
        just attendance. Every certificate carries a unique serial you can check
        online at any time.
      </p>

      <header className="mas-page-head mas-section-head"><h2>Child safety</h2></header>
      <p className="mas-lede">
        Assessments are conducted by independent examiners under
        conflict-of-interest rules, and your child’s personal details are never
        shown publicly. Verification works by serial only — the registry can’t be
        browsed for children’s names — so a certificate can be confirmed without
        exposing any private information.
      </p>

      <header className="mas-page-head mas-section-head"><h2>Getting started</h2></header>
      <p className="mas-lede">
        Find a recognised centre near you and enrol. When your child earns a
        badge, you’ll receive a claim code to link their record to your own
        account, where you can view their badges and verify each certificate.
      </p>

      <div className="mas-form-actions" style={{ marginTop: '1.25rem' }}>
        <Link className="mas-btn-primary" to="/find-a-centre">Find a centre near you</Link>
        <Link className="mas-btn-ghost" to="/verify">Verify a certificate</Link>
      </div>
    </section>
  );
}
