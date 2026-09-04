import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ChatVerseProvider } from "./app/AppState";
import { ApplicationShell, DocsShell, PresentationShell, SettingsShell } from "./app/Layout";
import HomePage from "./pages/HomePage";
import GroupLibraryPage from "./pages/GroupLibraryPage";
import WorldPage from "./pages/WorldPage";
import WorldManagePage from "./pages/WorldManagePage";
import WorldShell from "./pages/WorldShell";
import WorldTasksPage from "./pages/WorldTasksPage";
import WorldStoryPage from "./pages/WorldStoryPage";
import ShowcasePage from "./pages/ShowcasePage";
import WorldDebugPage from "./debug/WorldDebugPage";
import WorldStudioPage from "./pages/WorldStudioPage";
import GalgamePlayPage from "./pages/GalgamePlayPage";
import LegalPage from "./pages/LegalPage";
import RuntimeSettingsPage from "./pages/RuntimeSettingsPage";
import TokenUsagePage from "./pages/TokenUsagePage";
import { useSiteMode } from "./siteMode";
import SettingsPage from "./pages/SettingsPage";
import ImageModelSettingsPage from "./pages/ImageModelSettingsPage";
import DocsPage from "./docs/DocsPage";
import CorporateHomePage from "./pages/CorporateHomePage";

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const siteMode = useSiteMode();
  useDocumentTitle(siteMode);

  if (siteMode === "portal") {
    return (
      <Routes>
        <Route path="/" element={<CorporateHomePage />} />
        <Route element={<DocsShell />}>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Route>
        <Route element={<PresentationShell />}>
          <Route path="/showcase" element={<ShowcasePage />} />
          <Route path="/privacy" element={<LegalPage />} />
          <Route path="/terms" element={<LegalPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (siteMode === "showcase") {
    return (
      <Routes>
        <Route element={<DocsShell />}>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Route>
        <Route element={<PresentationShell />}>
          <Route path="/showcase" element={<ShowcasePage />} />
          <Route path="/privacy" element={<LegalPage />} />
          <Route path="/terms" element={<LegalPage />} />
          <Route path="*" element={<Navigate to="/showcase" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <ChatVerseProvider>
      <Routes>
          <Route element={<DocsShell />}>
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/docs/:slug" element={<DocsPage />} />
          </Route>
          <Route element={<ApplicationShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/worlds" element={<HomePage />} />
            <Route path="/worlds/new" element={<WorldStudioPage />} />
            <Route path="/worlds/drafts/:draftId" element={<WorldStudioPage />} />
            <Route path="/showcase" element={<ShowcasePage />} />
            <Route path="/privacy" element={<LegalPage />} />
            <Route path="/terms" element={<LegalPage />} />
            <Route path="/worlds/:worldId" element={<WorldShell />}>
              <Route index element={<WorldPage />} />
              <Route path="play" element={<GalgamePlayPage />} />
              <Route path="tasks" element={<WorldTasksPage />} />
              <Route path="story" element={<WorldStoryPage />} />
              <Route path="manage" element={<WorldManagePage />} />
              <Route path="manage/:section" element={<WorldManagePage />} />
              <Route path="debug" element={<WorldDebugPage />} />
            </Route>
            <Route path="/groups" element={<GroupLibraryPage />} />
            <Route path="/characters" element={<Navigate to="/worlds/new?view=characters" replace />} />
            <Route path="/usage" element={<TokenUsagePage />} />
            <Route path="/groups/new" element={<WorldStudioPage defaultProfile="group_chat" />} />
            <Route path="/settings" element={<SettingsShell />}>
              <Route index element={<Navigate to="models" replace />} />
              <Route path="models" element={<SettingsPage section="models" />} />
              <Route path="images" element={<ImageModelSettingsPage />} />
              <Route path="storage" element={<SettingsPage section="storage" />} />
              <Route path="runtime" element={<RuntimeSettingsPage />} />
              <Route path="developer" element={<SettingsPage section="developer" />} />
            </Route>
            <Route path="*" element={<Navigate to="/groups" replace />} />
          </Route>
      </Routes>
    </ChatVerseProvider>
  );
}

function useDocumentTitle(siteMode: "full" | "showcase" | "portal") {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === "/privacy") {
      document.title = "隐私政策 · ChatVerse";
      return;
    }
    if (pathname === "/terms") {
      document.title = "用户协议 · ChatVerse";
      return;
    }
    if (pathname === "/showcase") {
      document.title = "智能体编排展示 · ChatVerse";
      return;
    }
    if (pathname === "/settings/images") {
      document.title = "图片模型设置 · ChatVerse";
      return;
    }
    if (pathname === "/usage") {
      document.title = "Token 用量 · ChatVerse";
      return;
    }
    if (pathname === "/docs" || pathname.startsWith("/docs/")) {
      document.title = pathname === "/docs" ? "文档 · ChatVerse" : "文档参考 · ChatVerse";
      return;
    }
    document.title = siteMode === "portal"
      ? "ChatVerse · AI Product Studio"
      : "ChatVerse · 世界智能体编排";
  }, [pathname, siteMode]);
}
