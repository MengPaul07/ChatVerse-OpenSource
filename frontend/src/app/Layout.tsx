import {
  Bot,
  BookOpen,
  Compass,
  Clock3,
  Database,
  Image,
  ChartNoAxesCombined,
  FileText,
  Link,
  MessageCircle,
  Settings,
  Sparkles,
} from "lucide-react";
import { Link as RouterLink, NavLink, Outlet } from "react-router-dom";
import ReleaseAnnouncement from "../components/ReleaseAnnouncement";

const productNav = [
  { to: "/", label: "探索", icon: Compass, end: true },
  { to: "/groups", label: "我的世界", icon: BookOpen, end: true },
  { to: "/worlds/new", label: "创作", icon: Sparkles },
  { to: "/usage", label: "用量", icon: ChartNoAxesCombined },
  { to: "/settings/models", label: "设置", icon: Settings },
];
const docsNav = { to: "/docs", label: "文档", icon: FileText, end: false };
const mobileProductNav = productNav.filter((item) => [
  "/groups",
  "/worlds/new",
  "/usage",
  "/settings/models",
].includes(item.to));
mobileProductNav.push(docsNav);

export function ApplicationShell() {
  return (
    <div className="product-shell">
      <aside className="global-rail" aria-label="产品导航">
        <NavLink className="brand-mark" to="/groups" aria-label="ChatVerse 世界库">
          <span>CV</span>
        </NavLink>
        <nav className="global-nav">
        {productNav.map((item) => <GlobalNavItem key={item.to} {...item} />)}
        </nav>
        <div className="global-rail-footer">
          <RouterLink className="global-rail-docs" to="/docs" aria-label="文档">
            <FileText size={18} strokeWidth={1.8} />
            <span>文档</span>
          </RouterLink>
          <span className="status-dot status-dot-idle" aria-label="本地群库" />
        </div>
      </aside>
      <main className="product-main">
        <Outlet />
        <SiteComplianceFooter />
      </main>
      <ReleaseAnnouncement />
      <nav className="mobile-nav" aria-label="移动导航">
        {mobileProductNav.map((item) => <GlobalNavItem key={item.to} {...item} />)}
      </nav>
    </div>
  );
}

export function PresentationShell() {
  return (
    <div className="presentation-shell">
      <main className="presentation-shell-main">
        <Outlet />
        <SiteComplianceFooter />
      </main>
    </div>
  );
}

export function DocsShell() {
  return (
    <div className="docs-shell">
      <header className="docs-topbar">
        <RouterLink className="docs-brand" to="/docs" aria-label="ChatVerse 文档首页">
          <span className="docs-brand-mark">CV</span>
          <span className="docs-brand-copy"><strong>ChatVerse</strong><small>Documentation</small></span>
        </RouterLink>
        <div className="docs-topbar-actions">
          <span className="docs-topbar-status"><i /> docs / live</span>
          <RouterLink to="/showcase">产品展示</RouterLink>
          <RouterLink className="docs-topbar-workspace" to="/">打开工作台 <ArrowRightIcon /></RouterLink>
        </div>
      </header>
      <Outlet />
      <SiteComplianceFooter />
    </div>
  );
}

function ArrowRightIcon() {
  return <span aria-hidden="true">↗</span>;
}

function SiteComplianceFooter() {
  return (
    <footer className="site-compliance-footer">
      <nav className="site-compliance-links" aria-label="网站协议">
        <RouterLink to="/privacy">隐私政策</RouterLink>
        <span aria-hidden="true">·</span>
        <RouterLink to="/terms">用户协议</RouterLink>
      </nav>
      <a
        className="site-record-link"
        href="http://beian.miit.gov.cn/"
        target="_blank"
        rel="noreferrer"
      >
        京ICP备2026048747号
      </a>
      <span aria-hidden="true">·</span>
      <a
        className="site-record-link"
        href="https://beian.mps.gov.cn/#/query/webSearch?code=11011702000641"
        target="_blank"
        rel="noreferrer"
      >
        京公网安备11011702000641号
      </a>
    </footer>
  );
}

function GlobalNavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof MessageCircle; end?: boolean }) {
  return (
    <NavLink end={end} to={to} className={({ isActive }) => `global-nav-item${isActive ? " is-active" : ""}`}>
      <Icon size={19} strokeWidth={1.8} />
      <span>{label}</span>
    </NavLink>
  );
}

export function SettingsShell() {
  return (
    <div className="settings-shell">
      <aside className="workspace-nav settings-nav" aria-label="应用设置导航">
        <div className="workspace-identity settings-title"><Settings size={18} /><strong>应用设置</strong></div>
        <nav className="workspace-nav-list">
          <NavLink to="models" className={({ isActive }) => `workspace-nav-item back${isActive ? " is-active" : ""}`}><Bot size={17} /><span>文本模型</span></NavLink>
          <NavLink to="images" className={({ isActive }) => `workspace-nav-item back${isActive ? " is-active" : ""}`}><Image size={17} /><span>图片模型</span></NavLink>
          <NavLink to="storage" className={({ isActive }) => `workspace-nav-item back${isActive ? " is-active" : ""}`}><Database size={17} /><span>存储</span></NavLink>
          <NavLink to="runtime" className={({ isActive }) => `workspace-nav-item back${isActive ? " is-active" : ""}`}><Clock3 size={17} /><span>运行与节省</span></NavLink>
          <NavLink to="developer" className={({ isActive }) => `workspace-nav-item back${isActive ? " is-active" : ""}`}><Link size={17} /><span>开发者</span></NavLink>
        </nav>
      </aside>
      <section className="workspace-content"><Outlet /></section>
    </div>
  );
}
