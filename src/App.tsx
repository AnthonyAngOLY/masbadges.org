import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, ROLE_LABELS } from './lib/auth';
import { ContentOverridesProvider } from './lib/contentOverrides';
import Protected from './components/Protected';
import RequireRole from './components/RequireRole';
import ScrollToTop from './components/ScrollToTop';
import Icon from './components/Icon';
import AttentionDot from './components/AttentionDot';
import { supabase } from './lib/supabase';
import Home from './pages/Home';
import TheProgramme from './pages/TheProgramme';
import ForCentres from './pages/ForCentres';
import ForParents from './pages/ForParents';
import Contact from './pages/Contact';
import FAQ from './pages/FAQ';
import Guides from './pages/Guides';
import GuideDetail from './pages/GuideDetail';
import Instructors from './pages/Instructors';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Safeguarding from './pages/Safeguarding';
import Directory from './pages/Directory';
import Courses from './pages/Courses';
import Verify from './pages/Verify';
import SearchResults from './pages/SearchResults';
import Login from './pages/Login';
import ClaimSignup from './pages/ClaimSignup';
import AuthCallback from './pages/AuthCallback';
import ParentDashboard from './pages/ParentDashboard';
import SetPassword from './pages/SetPassword';
import AccountProvisioning from './pages/AccountProvisioning';
import NotFound from './pages/NotFound';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import RegisterCandidate from './pages/RegisterCandidate';
import RosterBooking from './pages/RosterBooking';
import ExaminerGrading from './pages/ExaminerGrading';
import Certificates from './pages/Certificates';
import CertificateIssuance from './pages/CertificateIssuance';
import CentreManagement from './pages/CentreManagement';
import MembershipManagement from './pages/MembershipManagement';
import AccountSettings from './pages/AccountSettings';
import CentreAdmin from './pages/CentreAdmin';
import CentrePublicDirectory from './pages/CentrePublicDirectory';
import PublicCentreDirectory from './pages/PublicCentreDirectory';
import ApplyPartnerCentre from './pages/ApplyPartnerCentre';
import ClaimCandidate from './pages/ClaimCandidate';
import ClaimSlips from './pages/ClaimSlips';
import Invitations from './pages/Invitations';
import InstructorOnboarding from './pages/InstructorOnboarding';
import InstructorBlacklist from './pages/InstructorBlacklist';
import CourseManagement from './pages/CourseManagement';
import Accounts from './pages/Accounts';
import MyInvoices from './pages/MyInvoices';
import PrintableDocument from './pages/PrintableDocument';
import PrintableCertificate from './pages/PrintableCertificate';
import MySessions from './pages/MySessions';
import BillingPayments from './pages/BillingPayments';
import PaymentVouchers from './pages/PaymentVouchers';
import MyPayouts from './pages/MyPayouts';
import Enquiries from './pages/Enquiries';
import WebsiteGuides from './pages/WebsiteGuides';
import WebsiteContentOverrides from './pages/WebsiteContentOverrides';
import RegisterCentre from './pages/RegisterCentre';
import PartnerApplications from './pages/PartnerApplications';
import PartnerApplicationForm from './pages/PartnerApplicationForm';
import RoleRegistry from './pages/RoleRegistry';
import SwimmerRegistry from './pages/SwimmerRegistry';
import AuditLog from './pages/AuditLog';
import ExaminerRegistry from './pages/ExaminerRegistry';
import CentreBilling from './pages/CentreBilling';
import Store from './pages/Store';
import StoreAdmin from './pages/StoreOrders';
import StoreProducts from './pages/StoreProducts';
import Settings from './pages/Settings';
import MyResources from './pages/MyResources';
import OnboardingQuiz from './pages/OnboardingQuiz';
import './styles/public.css';
import './styles/auth.css';
import './styles/admin.css';
import './styles/site.css';
import './styles/shell.css';
import './styles/theme.css';

const PORTAL_LOGIN: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PORTAL_LOGIN_URL ?? '/login';

// ---- host-based split ----------------------------------------------------
// Public marketing site serves from www.masbadges.org; the authenticated
// portal serves from apps.masbadges.org. Same repo, same Netlify site, two
// hostnames. The origin split gives portal sessions their own storage/cookie
// world so a public-page vulnerability cannot read a signed-in staff token.
//
// Rules on every request:
//   www host  → render only PUBLIC routes; any portal URL bounces to apps
//   apps host → render only PORTAL/AUTH routes; any public URL bounces to www
//   anything else (localhost, netlify previews, apex, bare IPs) → serve BOTH
//                                                                (dev/QA unaffected)
const PUBLIC_HOST = 'www.masbadges.org';
const APP_HOST    = 'apps.masbadges.org';
const BARE_APEX   = 'masbadges.org';

type HostMode = 'public' | 'portal' | 'both' | 'apex';

function classifyHost(host: string): HostMode {
  const h = host.toLowerCase();
  if (h === PUBLIC_HOST) return 'public';
  if (h === APP_HOST)    return 'portal';
  if (h === BARE_APEX)   return 'apex';
  return 'both';
}

// Which URL paths are portal-only vs public-only. Anything that's not clearly
// one or the other (e.g. /login, /auth/callback, /verify) is treated as
// SHARED and rendered on either host, so QR/email links keep working.
const PORTAL_PATH_PREFIXES = [
  '/dashboard', '/account', '/onboarding', '/claim', '/invoices',
  '/billing', '/certificate/', '/centre', '/candidates', '/assessments',
  '/my-sessions', '/certificates', '/admin', '/registry', '/parent',
  '/centres/register', '/store',
];
const PUBLIC_PATH_PREFIXES = [
  '/the-programme', '/for-centres', '/for-parents', '/contact', '/faq',
  '/guides', '/instructors', '/privacy', '/terms', '/safeguarding',
  '/directory', '/courses', '/search', '/find-a-centre', '/apply-partner-centre',
];

function isPortalPath(p: string): boolean {
  return PORTAL_PATH_PREFIXES.some((x) => p === x || p.startsWith(x + '/'));
}
function isPublicPath(p: string): boolean {
  if (p === '/') return true;
  return PUBLIC_PATH_PREFIXES.some((x) => p === x || p.startsWith(x + '/'));
}

// Full-URL redirect helper. Uses window.location so Netlify sees the request
// on the other origin (rather than trying to rewrite in the SPA).
function redirectToHost(host: string, path: string, search: string): void {
  const target = `https://${host}${path}${search}`;
  if (window.location.href === target) return;
  window.location.replace(target);
}

// Sits at the top of the tree. On a canonicalised host it bounces any URL
// belonging to the other side; on unknown hosts (localhost etc.) it is a
// no-op and the full route tree renders as before.
function HostGuard() {
  const location = useLocation();
  const host = window.location.hostname;
  const mode = classifyHost(host);
  useEffect(() => {
    if (mode === 'both') return;
    const p = location.pathname;
    // Bare apex always canonicalizes to www so the address bar shows www.
    // (Netlify's 301 also does this at the edge, but doing it here guarantees
    // the browser URL reflects reality even if the edge redirect got cached
    // before the primary flip.)
    if (mode === 'apex')
      redirectToHost(PUBLIC_HOST, p, location.search);
    if (mode === 'public' && isPortalPath(p))
      redirectToHost(APP_HOST, p, location.search);
    if (mode === 'portal' && isPublicPath(p))
      redirectToHost(PUBLIC_HOST, p, location.search);
  }, [location.pathname, location.search, mode]);
  return null;
}

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'is-active' : '');

function initials(email?: string | null): string {
  if (!email) return 'U';
  const name = email.split('@')[0];
  const parts = name.split(/[._-]/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'U') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Brand() {
  return (
    <Link to="/" className="mas-brand" aria-label="MAS Swim Badges — home">
      <img
        src="/mas-logo.png"
        alt="MAS Swim Badges"
        className="mas-logo"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
      />
    </Link>
  );
}

/* ---------- Public marketing layout (www) ---------- */
function PublicLayout() {
  const loginIsExternal = /^https?:\/\//i.test(PORTAL_LOGIN);
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setOpenSection(null);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
    setSearchOpen(false);
    setMenuOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const toggleSection = (key: string) =>
    setOpenSection((cur) => (cur === key ? null : key));

  return (
    <div className="mas-site">
      <header className={`mas-topnav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="mas-utilitybar">
          <div className="mas-utilitybar-inner">
            <Link to="/contact" className="mas-utilitybar-link">Contact us</Link>
          </div>
        </div>
        <div className="mas-topnav-inner">
        <Brand />
        <nav
          id="mas-mobile-nav"
          className={`mas-topnav-links${menuOpen ? ' is-open' : ''}`}
          onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenuOpen(false); }}
        >
          <form className="mas-search-mobile" role="search" onSubmit={submitSearch}>
            <input
              className="mas-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the site…"
              aria-label="Search the site"
            />
            <button type="submit" className="mas-search-mobile-btn" aria-label="Search">
              <Icon name="search" />
            </button>
          </form>

          <NavLink to="/the-programme" className={navClass}>The programme</NavLink>

          <div className={`mas-navitem mas-has-menu${openSection === 'centre' ? ' is-open' : ''}`}>
            <div className="mas-navitem-top">
              <NavLink to="/directory" className={({ isActive }) => `mas-menu-top${isActive ? ' is-active' : ''}`}>Find a centre</NavLink>
              <button
                type="button"
                className="mas-submenu-toggle"
                aria-expanded={openSection === 'centre'}
                aria-label="Toggle Find a centre links"
                onClick={() => toggleSection('centre')}
              >
                <span className="mas-submenu-caret" aria-hidden="true" />
              </button>
            </div>
            <div className="mas-submenu">
              <NavLink to="/directory">Browse the directory</NavLink>
              <NavLink to="/for-centres">Become a partner centre</NavLink>
            </div>
          </div>

          <NavLink to="/instructors" className={navClass}>Instructors</NavLink>

          <div className={`mas-navitem mas-has-menu${openSection === 'guides' ? ' is-open' : ''}`}>
            <div className="mas-navitem-top">
              <NavLink to="/guides" className={({ isActive }) => `mas-menu-top${isActive ? ' is-active' : ''}`}>Guides</NavLink>
              <button
                type="button"
                className="mas-submenu-toggle"
                aria-expanded={openSection === 'guides'}
                aria-label="Toggle Guides links"
                onClick={() => toggleSection('guides')}
              >
                <span className="mas-submenu-caret" aria-hidden="true" />
              </button>
            </div>
            <div className="mas-submenu mas-submenu-wide">
              <NavLink to="/guides" className="mas-submenu-head">All guides</NavLink>
              <NavLink to="/guides/how-it-works">How MAS BADGES works</NavLink>
              <NavLink to="/guides/enrol">Getting into the Badges</NavLink>
              <NavLink to="/guides/claim">Claiming your child</NavLink>
              <NavLink to="/guides/certificates">Viewing certificates &amp; levels</NavLink>
              <NavLink to="/guides/verify">Authenticating a certificate</NavLink>
              <NavLink to="/guides/assessment">The assessment guide</NavLink>
              <NavLink to="/guides/instructor-pathway">Instructor pathway</NavLink>
              <NavLink to="/guides/examiner-pathway">Examiner pathway</NavLink>
            </div>
          </div>

          <NavLink to="/courses" className={navClass}>Courses</NavLink>
          <NavLink to="/faq" className={navClass}>FAQ</NavLink>
        </nav>
        <form
          className={`mas-search${searchOpen ? ' is-open' : ''}`}
          role="search"
          onSubmit={submitSearch}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setSearchOpen(false);
          }}
        >
          <input
            ref={searchInputRef}
            className="mas-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
            placeholder="Search the site…"
            aria-label="Search the site"
            aria-hidden={!searchOpen}
            tabIndex={searchOpen ? 0 : -1}
          />
          <button
            type="button"
            className="mas-search-toggle"
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen((o) => !o);
            }}
          >
            <Icon name="search" />
          </button>
        </form>
        {loginIsExternal ? (
          <a href={PORTAL_LOGIN} className="mas-login-btn">Portal login</a>
        ) : (
          <Link to={PORTAL_LOGIN} className="mas-login-btn">Portal login</Link>
        )}
        <button
          type="button"
          className="mas-nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="mas-mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className={`mas-burger${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
            <span></span><span></span><span></span>
          </span>
        </button>
        </div>
      </header>

      <main className="mas-main"><Outlet /></main>

      <footer className="mas-site-footer">
        <div className="mas-footer-cols">
          <div>
            <h4>Programme</h4>
            <Link to="/the-programme">The programme</Link>
            <Link to="/directory">Find a centre</Link>
            <Link to="/instructors">Instructors</Link>
            <Link to="/courses">Courses</Link>
          </div>
          <div>
            <h4>Get involved</h4>
            <Link to="/for-parents">For parents</Link>
            <Link to="/for-centres">For centres</Link>
            <Link to="/verify">Verify a certificate</Link>
          </div>
          <div>
            <h4>About</h4>
            <Link to="/#about">About &amp; governance</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/faq">FAQ</Link>
          </div>
          <div>
            <h4>Legal</h4>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/safeguarding">Child safeguarding</Link>
          </div>
        </div>
        <div className="mas-footer-base">© Malaysia Aquatics · Swim Badges programme</div>
      </footer>
    </div>
  );
}

/* ---------- Portal sidebar (apps) ---------- */
function Sidebar({
  open,
  onClose,
  onAttentionChange,
}: {
  open: boolean;
  onClose: () => void;
  onAttentionChange?: (total: number) => void;
}) {
  const { user, memberships, hasRole } = useAuth();

  const isGovernance =
    hasRole('chairperson') || hasRole('board_member') || hasRole('chief_examiner');
  const canManageCentres = hasRole('chairperson') || hasRole('board_member');
  const canCentreDirectory = hasRole('system_admin') || hasRole('finance_officer') || hasRole('chairperson') || hasRole('board_member') || hasRole('chief_examiner');
  const canManageMembers = hasRole('chairperson') || hasRole('board_member');
  const canCentreAdmin = hasRole('partner_center_admin');
  const canRegister = hasRole('instructor') || isGovernance;
  const canSchedule = hasRole('instructor') || isGovernance;
  const canGrade = hasRole('examiner') || isGovernance;
  const canViewCerts = hasRole('examiner') || isGovernance;
  const canInvitations = hasRole('examiner');
  const canAccounts = hasRole('system_admin') || hasRole('finance_officer');
  const canMyInvoices = hasRole('instructor') || hasRole('partner_center_admin');
  const canMySessions =
    hasRole('instructor') || hasRole('master_trainer') || hasRole('examiner') ||
    hasRole('finance_officer') || isGovernance;
  const canBilling = hasRole('finance_officer') || hasRole('system_admin') || hasRole('chairperson');
  // Money out: the finance desk prepares and pays, the approvers approve.
  const canVouchers =
    hasRole('finance_officer') || hasRole('finance_approver') ||
    hasRole('system_admin') || hasRole('chairperson');
  // Anyone who can be paid gets their own payout view.
  const canMyPayouts =
    hasRole('examiner') || hasRole('instructor') || hasRole('partner_center_admin') ||
    hasRole('master_trainer') || hasRole('instructor_trainer') || hasRole('examiner_trainer');
  const canClaimSlips = canRegister;
  const canOnboard =
    hasRole('instructor_trainer') || hasRole('chairperson') || hasRole('board_member');
  const canBlacklist = canManageMembers;
  const canManageCourses =
    hasRole('instructor_trainer') || hasRole('examiner_trainer') ||
    hasRole('chairperson') || hasRole('board_member');
  const canEnquiries =
    hasRole('chairperson') || hasRole('board_member') ||
    hasRole('instructor_trainer') || hasRole('system_admin');
  const canRegisterCentre = hasRole('instructor');
  const canPartnerApps = hasRole('chairperson') || hasRole('board_member');
  const canRoleRegistry = hasRole('system_admin');
  const canSwimmerRegistry = hasRole('instructor') || hasRole('partner_center_admin') || hasRole('chairperson') || hasRole('system_admin') || hasRole('finance_officer');
  const canAuditLog = hasRole('system_admin') || hasRole('chairperson');
  const canProvisionAccounts = hasRole('system_admin') || hasRole('chairperson');
  const canExaminerRegistry = hasRole('chief_examiner');
  const canCentreBilling = hasRole('chairperson') || hasRole('board_member') || hasRole('system_admin');
  const canBuyStore = hasRole('instructor') || hasRole('partner_center_admin') || hasRole('examiner');
  const canManageStore = hasRole('system_admin') || hasRole('chairperson') || hasRole('board_member');
  const canStoreProducts = hasRole('system_admin') || hasRole('finance_officer');
  const canSystemSettings = hasRole('system_admin');

  const isStaffOperator =
    hasRole('chairperson') || hasRole('board_member') || hasRole('chief_examiner') ||
    hasRole('instructor') || hasRole('examiner') || hasRole('instructor_trainer') ||
    hasRole('examiner_trainer') || hasRole('partner_center_admin') || hasRole('system_admin');

  const assessmentsGroup =
    canRegister || canSchedule || canGrade || canInvitations || canViewCerts || isGovernance || canClaimSlips || canMySessions;
  const billingGroup = canAccounts || canMyInvoices || canCentreBilling || canManageStore || canStoreProducts || canBilling || canVouchers || canMyPayouts;
  const governanceGroup =
    canManageCentres || canManageMembers || canOnboard || canBlacklist || canManageCourses || canEnquiries || canPartnerApps || canAuditLog || canCentreDirectory;
  const systemGroup =
    canSystemSettings || canRoleRegistry;

  const primaryRole = memberships[0]?.role;
  const roleLabel = primaryRole ? (ROLE_LABELS[primaryRole] ?? primaryRole) : 'Member';

  const location = useLocation();
  const [unhandledEnquiries, setUnhandledEnquiries] = useState(0);
  useEffect(() => {
    if (!canEnquiries) { setUnhandledEnquiries(0); return; }
    let active = true;
    supabase.rpc('count_unhandled_enquiries').then(({ data }) => {
      if (active) setUnhandledEnquiries(typeof data === 'number' ? data : 0);
    });
    return () => { active = false; };
  }, [canEnquiries, location.pathname]);

  const [unhandledPartnerApps, setUnhandledPartnerApps] = useState(0);
  useEffect(() => {
    if (!canPartnerApps) { setUnhandledPartnerApps(0); return; }
    let active = true;
    supabase.rpc('count_unhandled_partner_applications').then(({ data }) => {
      if (active) setUnhandledPartnerApps(typeof data === 'number' ? data : 0);
    });
    return () => { active = false; };
  }, [canPartnerApps, location.pathname]);

  const [outstandingInvoices, setOutstandingInvoices] = useState(0);
  useEffect(() => {
    if (!canBilling) { setOutstandingInvoices(0); return; }
    let active = true;
    supabase.rpc('count_outstanding_invoices').then(({ data }) => {
      if (active) setOutstandingInvoices(typeof data === 'number' ? data : 0);
    });
    return () => { active = false; };
  }, [canBilling, location.pathname]);

  const [pendingVouchers, setPendingVouchers] = useState(0);
  useEffect(() => {
    if (!canVouchers) { setPendingVouchers(0); return; }
    let active = true;
    supabase.rpc('count_pending_voucher_approvals').then(({ data }) => {
      if (active) setPendingVouchers(typeof data === 'number' ? data : 0);
    });
    return () => { active = false; };
  }, [canVouchers, location.pathname]);

  const [openSessions, setOpenSessions] = useState(0);
  useEffect(() => {
    if (!canInvitations) { setOpenSessions(0); return; }
    let active = true;
    supabase.rpc('count_open_sessions').then(({ data }) => {
      if (active) setOpenSessions(typeof data === 'number' ? data : 0);
    });
    return () => { active = false; };
  }, [canInvitations, location.pathname]);

  const [onboardingDue, setOnboardingDue] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.rpc('get_onboarding_status').then(({ data, error }) => {
      if (!active) return;
      const rows = (data ?? []) as Array<{ outstanding?: string[] }>;
      setOnboardingDue(!error && rows.some((r) => r.outstanding?.includes('quiz')));
    });
    return () => { active = false; };
  }, [location.pathname]);

  useEffect(() => {
    onAttentionChange?.(unhandledEnquiries + unhandledPartnerApps);
  }, [unhandledEnquiries, unhandledPartnerApps, onAttentionChange]);

  return (
    <>
      <div
        className={`mas-sidebar-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="mas-portal-sidebar"
        className={`mas-sidebar${open ? ' is-open' : ''}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onClose(); }}
      >
      <Brand />

      <nav className="mas-sidenav">
        <NavLink to="/dashboard" className={navClass}><Icon name="grid" /><span>Dashboard</span></NavLink>
        {onboardingDue && <NavLink to="/onboarding" className={navClass}><Icon name="check" /><span>Onboarding quiz</span><AttentionDot count={1} label="onboarding quiz outstanding" /></NavLink>}
        {canBuyStore && <NavLink to="/store" className={navClass}><Icon name="card" /><span>Store</span></NavLink>}

        {assessmentsGroup && (canRegister || canSwimmerRegistry || canClaimSlips) && (
          <details className="mas-navgroup" open>
            <summary>Candidates</summary>
            <div className="mas-navgroup-items">
              {canRegister && <NavLink to="/candidates/register" className={navClass}><Icon name="userPlus" /><span>Register candidate</span></NavLink>}
              {canSwimmerRegistry && <NavLink to="/registry/swimmers" className={navClass}><Icon name="users" /><span>Swimmer registry</span></NavLink>}
              {canClaimSlips && <NavLink to="/candidates/claim-slips" className={navClass}><Icon name="printer" /><span>Claim slips</span></NavLink>}
            </div>
          </details>
        )}

        {assessmentsGroup && (
          <details className="mas-navgroup" open>
            <summary>Assessments</summary>
            <div className="mas-navgroup-items">
              {canRegisterCentre && <NavLink to="/centres/register" className={navClass}><Icon name="building" /><span>Register a centre</span></NavLink>}
              {canSchedule && <NavLink to="/assessments/schedule" className={navClass}><Icon name="calendar" /><span>Schedule assessment</span></NavLink>}
              {canMySessions && <NavLink to="/my-sessions" className={navClass}><Icon name="calendar" /><span>My sessions</span></NavLink>}
              {canGrade && <NavLink to="/assessments/grade" className={navClass}><Icon name="check" /><span>Grading</span></NavLink>}
              {canInvitations && <NavLink to="/assessments/invitations" className={navClass}><Icon name="inbox" /><span>Available sessions</span><AttentionDot count={openSessions} variant="count" label="available sessions" /></NavLink>}
              {isGovernance && <NavLink to="/certificates/issue" className={navClass}><Icon name="award" /><span>Issue certificates</span></NavLink>}
              {canViewCerts && <NavLink to="/certificates" end className={navClass}><Icon name="award" /><span>Certificates</span></NavLink>}
              {canExaminerRegistry && <NavLink to="/assessments/examiners" className={navClass}><Icon name="users" /><span>Examiner registry</span></NavLink>}
            </div>
          </details>
        )}

        {billingGroup && (
          <details className="mas-navgroup" open>
            <summary>Billing</summary>
            <div className="mas-navgroup-items">
              {canAccounts && <NavLink to="/admin/accounts" className={navClass}><Icon name="card" /><span>Session payouts</span></NavLink>}
              {canCentreBilling && <NavLink to="/admin/centre-billing" className={navClass}><Icon name="building" /><span>Centre billing</span></NavLink>}
              {canStoreProducts && <NavLink to="/admin/store-products" className={navClass}><Icon name="grid" /><span>Store products</span></NavLink>}
              {canManageStore && <NavLink to="/admin/store" className={navClass}><Icon name="inbox" /><span>Store orders</span></NavLink>}
              {canBilling && <NavLink to="/billing/payments" className={navClass}><Icon name="card" /><span>Invoices &amp; Payments</span><AttentionDot count={outstandingInvoices} variant="count" label="outstanding invoices" /></NavLink>}
              {canVouchers && <NavLink to="/billing/vouchers" className={navClass}><Icon name="file" /><span>Payment vouchers</span><AttentionDot count={pendingVouchers} variant="count" label="vouchers awaiting approval" /></NavLink>}
              {canMyInvoices && <NavLink to="/invoices" className={navClass}><Icon name="file" /><span>My invoices</span></NavLink>}
              {canMyPayouts && <NavLink to="/my-payouts" className={navClass}><Icon name="card" /><span>My payouts</span></NavLink>}
            </div>
          </details>
        )}

        {governanceGroup && (
          <details className="mas-navgroup" open>
            <summary>Governance</summary>
            <div className="mas-navgroup-items">
              {canEnquiries && <NavLink to="/admin/enquiries" className={navClass}><Icon name="inbox" /><span>Enquiries</span><AttentionDot count={unhandledEnquiries} label="unhandled enquiries" /></NavLink>}
              {canPartnerApps && <NavLink to="/admin/partner-applications" className={navClass}><Icon name="check" /><span>Centre applications</span><AttentionDot count={unhandledPartnerApps} label="new applications" /></NavLink>}
              {canManageCentres && <NavLink to="/admin/centres" className={navClass}><Icon name="building" /><span>Manage centres</span></NavLink>}
              {canCentreDirectory && <NavLink to="/admin/centre-directory" className={navClass}><Icon name="grid" /><span>Public directory</span></NavLink>}
              {canManageMembers && <NavLink to="/admin/memberships" className={navClass}><Icon name="users" /><span>Memberships</span></NavLink>}
              {canOnboard && <NavLink to="/admin/instructors" className={navClass}><Icon name="userPlus" /><span>Instructor onboarding</span></NavLink>}
              {canBlacklist && <NavLink to="/admin/instructor-blacklist" className={navClass}><Icon name="userX" /><span>Instructor blacklist</span></NavLink>}
              {canManageCourses && <NavLink to="/admin/courses" className={navClass}><Icon name="book" /><span>Manage courses</span></NavLink>}
              {canAuditLog && <NavLink to="/admin/audit-log" className={navClass}><Icon name="file" /><span>Audit log</span></NavLink>}
            </div>
          </details>
        )}

        {systemGroup && (
          <details className="mas-navgroup" open>
            <summary>System</summary>
            <div className="mas-navgroup-items">
              {canSystemSettings && <NavLink to="/admin/settings" className={navClass}><Icon name="settings" /><span>Settings</span></NavLink>}
              {canRoleRegistry && <NavLink to="/admin/role-registry" className={navClass}><Icon name="settings" /><span>Roles &amp; policies</span></NavLink>}
            </div>
          </details>
        )}

        {canSystemSettings && (
          <details className="mas-navgroup" open>
            <summary>Website</summary>
            <div className="mas-navgroup-items">
              <NavLink to="/admin/website/guides" className={navClass}><Icon name="book" /><span>Guides</span></NavLink>
              <NavLink to="/admin/website/content-overrides" className={navClass}><Icon name="file" /><span>Content overrides</span></NavLink>
            </div>
          </details>
        )}

        <details className="mas-navgroup" open>
          <summary>Account</summary>
          <div className="mas-navgroup-items">
            {!isStaffOperator && <NavLink to="/claim" className={navClass}><Icon name="star" /><span>My child&rsquo;s badges</span></NavLink>}
            <NavLink to="/account" className={navClass}><Icon name="settings" /><span>Account</span></NavLink>
            <NavLink to="/account/resources" className={navClass}><Icon name="book" /><span>My resources</span></NavLink>
            {canCentreAdmin && <NavLink to="/centre" className={navClass}><Icon name="building" /><span>My centre</span></NavLink>}
          </div>
        </details>
      </nav>

      <Link to="/account" className="mas-profile">
        <span className="mas-avatar">{initials(user?.email)}</span>
        <span className="mas-profile-meta">
          <span className="mas-profile-name">{user?.email ?? 'Account'}</span>
          <span className="mas-profile-role">{roleLabel}</span>
        </span>
      </Link>
      </aside>
    </>
  );
}

/* ---------- Portal layout (apps) ---------- */
const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/account': 'Account',
  '/onboarding': 'Onboarding quiz',
  '/claim': "My child's badges",
  '/invoices': 'My invoices',
  '/centre': 'My centre',
  '/candidates/register': 'Register candidate',
  '/candidates/claim-slips': 'Claim slips',
  '/assessments/schedule': 'Schedule assessment',
  '/assessments/grade': 'Grading',
  '/assessments/invitations': 'Available sessions',
  '/assessments/examiners': 'Examiner registry',
  '/certificates/issue': 'Issue certificates',
  '/certificates': 'Certificates',
  '/admin/accounts': 'Session payouts',
  '/admin/centre-billing': 'Centre billing',
  '/billing/payments': 'Invoices & Payments',
  '/billing/vouchers': 'Payment vouchers',
  '/my-payouts': 'My payouts',
  '/store': 'Store',
  '/admin/store': 'Store orders',
  '/admin/store-products': 'Store products',
  '/admin/instructors': 'Instructor onboarding',
  '/admin/instructor-blacklist': 'Instructor blacklist',
  '/admin/courses': 'Manage courses',
  '/admin/centres': 'Manage centres',
  '/admin/centre-directory': 'Centre public directory',
  '/admin/memberships': 'Memberships',
  '/admin/enquiries': 'Enquiries',
  '/centres/register': 'Register a centre',
  '/admin/partner-applications': 'Centre applications',
  '/admin/role-registry': 'Roles & policies',
  '/admin/settings': 'System settings',
  '/admin/website/guides': 'Website · Guides',
  '/admin/website/content-overrides': 'Website · Content overrides',
  '/account/resources': 'My resources',
  '/registry/swimmers': 'Swimmer registry',
  '/admin/audit-log': 'Audit log',
};

function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? 'Portal';

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attentionTotal, setAttentionTotal] = useState(0);
  const [needsQuiz, setNeedsQuiz] = useState<boolean | null>(null);

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Onboarding quiz gate. Instructors/examiners who haven't passed their
  // first-login theory quiz are sent to /onboarding (which lives outside
  // AppLayout, so there is no redirect loop). Checked once per signed-in user.
  useEffect(() => {
    if (!user || user?.user_metadata?.must_change_password === true) {
      setNeedsQuiz(false);
      return;
    }
    let active = true;
    supabase.rpc('needs_onboarding').then(({ data, error }) => {
      if (active) setNeedsQuiz(!error && data === true);
    });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sidebarOpen]);

  // Guards run after all hooks so hook order stays stable across renders.
  // Force-change password guard (#22 D2). If the signed-in user carries
  // must_change_password: true in their user_metadata, block the portal and
  // redirect to /set-password. SetPassword itself lives outside AppLayout, so
  // it isn't caught by this guard — it can clear the flag and land the user
  // back on /dashboard.
  if (user?.user_metadata?.must_change_password === true) {
    return <Navigate to="/set-password" replace />;
  }
  // Onboarding quiz guard. /onboarding lives outside AppLayout, so redirecting
  // there unmounts this layout; passing the quiz clears needs_onboarding() and
  // the user lands back in the portal with no loop.
  if (needsQuiz === true && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="mas-layout">
      <style>{`
        .mas-shell-main:has(.mas-page-wide),
        .mas-main:has(.mas-page-wide) {
          max-width: none !important;
          width: auto !important;
        }
        .mas-page-wide {
          max-width: none !important;
          width: auto !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        .mas-tight { font-size: 0.78rem; }
        .mas-tight thead th { font-size: 0.72rem; }
      `}</style>
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onAttentionChange={setAttentionTotal}
      />
      <div className="mas-shell-main">
        <header className="mas-topbar-app">
          <div className="mas-topbar-left">
            <button
              type="button"
              className="mas-sidebar-toggle"
              aria-expanded={sidebarOpen}
              aria-controls="mas-portal-sidebar"
              aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setSidebarOpen((o) => !o)}
            >
              <span className={`mas-burger${sidebarOpen ? ' is-open' : ''}`} aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              {attentionTotal > 0 && (
                <span
                  className="mas-toggle-dot"
                  role="status"
                  aria-label={`${attentionTotal} items need attention`}
                />
              )}
            </button>
            <div className="mas-breadcrumb">
              <span className="mas-crumb-muted">Portal</span>
              <span className="mas-crumb-sep">›</span>
              <span className="mas-crumb-here">{title}</span>
            </div>
          </div>
          <div className="mas-topbar-right">
            <Link to="/" className="mas-topbar-link">View site</Link>
            <button className="mas-signout" onClick={handleSignOut}>Sign out</button>
            <span className="mas-avatar mas-avatar-sm" title={user?.email ?? ''}>{initials(user?.email)}</span>
          </div>
        </header>
        <main className="mas-main"><Outlet /></main>
        <footer className="mas-footer">
          <p>© Malaysia Aquatics · Swim Badges programme</p>
        </footer>
      </div>
    </div>
  );
}

function OnboardingScreen() {
  // Full navigation on completion so AppLayout remounts and re-runs its
  // needs_onboarding() check. An in-app navigate() would keep AppLayout mounted
  // with its cached needsQuiz === true, and the hard gate would bounce the user
  // straight back here — the "stuck after passing" bug.
  return <OnboardingQuiz onComplete={() => { window.location.assign('/dashboard'); }} />;
}

export default function App() {
  return (
    <AuthProvider>
      <ContentOverridesProvider>
      <BrowserRouter>
        <HostGuard />
        <ScrollToTop />
        <div className="mas-app">
          <ErrorBoundary>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/the-programme" element={<TheProgramme />} />
              <Route path="/for-centres" element={<ForCentres />} />
              <Route path="/for-parents" element={<ForParents />} />
              <Route path="/find-a-centre" element={<PublicCentreDirectory />} />
              <Route path="/apply-partner-centre" element={<ApplyPartnerCentre />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/guides" element={<Guides />} />
              <Route path="/guides/:slug" element={<GuideDetail />} />
              <Route path="/instructors" element={<Instructors />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/safeguarding" element={<Safeguarding />} />
              <Route path="/directory" element={<Directory />} />
              <Route path="/courses" element={<Courses />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/verify/:serial" element={<Verify />} />
              <Route path="/search" element={<SearchResults />} />
            </Route>

            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/account" element={<Protected><AccountSettings /></Protected>} />
              <Route path="/onboarding" element={<Protected><OnboardingScreen /></Protected>} />
              <Route path="/claim" element={<Protected><ClaimCandidate /></Protected>} />
              <Route path="/invoices" element={<RequireRole roles={['instructor', 'partner_center_admin']}><MyInvoices /></RequireRole>} />
              <Route path="/billing/invoice/:id" element={<RequireRole roles={['instructor', 'partner_center_admin', 'master_trainer', 'finance_officer', 'system_admin', 'chairperson', 'chief_examiner']}><PrintableDocument mode="invoice" /></RequireRole>} />
              <Route path="/billing/receipt/:id" element={<RequireRole roles={['instructor', 'partner_center_admin', 'master_trainer', 'finance_officer', 'system_admin', 'chairperson', 'chief_examiner']}><PrintableDocument mode="receipt" /></RequireRole>} />
              <Route path="/billing/voucher/:id" element={<RequireRole roles={['instructor', 'examiner', 'partner_center_admin', 'finance_officer', 'finance_approver', 'system_admin', 'chairperson']}><PrintableDocument mode="voucher" /></RequireRole>} />
              <Route path="/certificate/:serial" element={<Protected><PrintableCertificate /></Protected>} />
              <Route path="/centre" element={<RequireRole roles={['partner_center_admin']}><CentreAdmin /></RequireRole>} />
              <Route path="/candidates/register" element={<RequireRole roles={['instructor', 'chairperson', 'board_member', 'chief_examiner']}><RegisterCandidate /></RequireRole>} />
              <Route path="/candidates/claim-slips" element={<RequireRole roles={['instructor', 'chairperson', 'board_member', 'chief_examiner']}><ClaimSlips /></RequireRole>} />
              <Route path="/assessments/schedule" element={<RequireRole roles={['instructor', 'chairperson', 'board_member', 'chief_examiner']}><RosterBooking /></RequireRole>} />
              <Route path="/my-sessions" element={<RequireRole roles={['instructor', 'master_trainer', 'examiner', 'finance_officer', 'chairperson', 'board_member', 'chief_examiner', 'system_admin']}><MySessions /></RequireRole>} />
              <Route path="/assessments/grade" element={<RequireRole roles={['examiner', 'chief_examiner', 'chairperson', 'board_member']}><ExaminerGrading /></RequireRole>} />
              <Route path="/assessments/invitations" element={<RequireRole roles={['examiner']}><Invitations /></RequireRole>} />
              <Route path="/assessments/examiners" element={<RequireRole roles={['chief_examiner']}><ExaminerRegistry /></RequireRole>} />
              <Route path="/certificates/issue" element={<RequireRole roles={['chairperson', 'board_member', 'chief_examiner']}><CertificateIssuance /></RequireRole>} />
              <Route path="/certificates" element={<RequireRole roles={['examiner', 'chief_examiner', 'chairperson', 'board_member']}><Certificates /></RequireRole>} />
              <Route path="/admin/accounts" element={<RequireRole roles={['system_admin', 'finance_officer']}><Accounts /></RequireRole>} />
              <Route path="/admin/centre-billing" element={<RequireRole roles={['chairperson', 'board_member', 'system_admin']}><CentreBilling /></RequireRole>} />
              <Route path="/billing/payments" element={<RequireRole roles={['finance_officer', 'system_admin', 'chairperson']}><BillingPayments /></RequireRole>} />
              <Route path="/billing/vouchers" element={<RequireRole roles={['finance_officer', 'finance_approver', 'system_admin', 'chairperson']}><PaymentVouchers /></RequireRole>} />
              <Route path="/my-payouts" element={<RequireRole roles={['examiner', 'instructor', 'partner_center_admin', 'master_trainer', 'instructor_trainer', 'examiner_trainer', 'finance_officer', 'system_admin', 'chairperson']}><MyPayouts /></RequireRole>} />
              <Route path="/store" element={<RequireRole roles={['instructor', 'partner_center_admin', 'examiner']}><Store /></RequireRole>} />
              <Route path="/admin/store" element={<RequireRole roles={['system_admin', 'chairperson', 'board_member']}><StoreAdmin /></RequireRole>} />
              <Route path="/admin/store-products" element={<RequireRole roles={['system_admin', 'finance_officer']}><StoreProducts /></RequireRole>} />
              <Route path="/admin/instructors" element={<RequireRole roles={['instructor_trainer', 'chairperson', 'board_member']}><InstructorOnboarding /></RequireRole>} />
              <Route path="/admin/instructor-blacklist" element={<RequireRole roles={['chairperson', 'board_member']}><InstructorBlacklist /></RequireRole>} />
              <Route path="/admin/courses" element={<RequireRole roles={['instructor_trainer', 'examiner_trainer', 'chairperson', 'board_member']}><CourseManagement /></RequireRole>} />
              <Route path="/admin/centres" element={<RequireRole roles={['chairperson', 'board_member']}><CentreManagement /></RequireRole>} />
              <Route path="/admin/centre-directory" element={<RequireRole roles={['system_admin', 'finance_officer', 'chairperson', 'board_member', 'chief_examiner']}><CentrePublicDirectory /></RequireRole>} />
              <Route path="/admin/enquiries" element={<RequireRole roles={['chairperson', 'board_member', 'instructor_trainer', 'system_admin']}><Enquiries /></RequireRole>} />
              <Route path="/centres/register" element={<RequireRole roles={['instructor']}><RegisterCentre /></RequireRole>} />
              <Route path="/admin/partner-applications" element={<RequireRole roles={['chairperson', 'board_member']}><PartnerApplications /></RequireRole>} />
              <Route path="/admin/role-registry" element={<RequireRole roles={['system_admin']}><RoleRegistry /></RequireRole>} />
              <Route path="/registry/swimmers" element={<RequireRole roles={['instructor', 'partner_center_admin', 'chairperson', 'system_admin', 'finance_officer']}><SwimmerRegistry /></RequireRole>} />
              <Route path="/admin/audit-log" element={<RequireRole roles={['system_admin', 'chairperson']}><AuditLog /></RequireRole>} />
              <Route path="/admin/memberships" element={<RequireRole roles={['chairperson', 'board_member']}><MembershipManagement /></RequireRole>} />
<Route path="/admin/staff" element={<Navigate to="/admin/settings" replace />} />
              <Route path="/admin/settings" element={<RequireRole roles={['system_admin']}><Settings /></RequireRole>} />
              <Route path="/admin/website/guides" element={<RequireRole roles={['system_admin']}><WebsiteGuides /></RequireRole>} />
              <Route path="/admin/website/content-overrides" element={<RequireRole roles={['system_admin']}><WebsiteContentOverrides /></RequireRole>} />
              <Route path="/account/resources" element={<MyResources />} />
              <Route path="/my-application" element={<PartnerApplicationForm />} />
            </Route>

            <Route path="/login" element={<Login />} />
            <Route path="/claim-signup" element={<ClaimSignup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route element={<Protected />}>
              <Route path="/parent" element={<ParentDashboard />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </ErrorBoundary>
        </div>
      </BrowserRouter>
      </ContentOverridesProvider>
    </AuthProvider>
  );
}
