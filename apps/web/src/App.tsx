import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Landing, FaqJsonLd } from './ui/marketing/Landing';
import { Editor } from './ui/editor/Editor';
import { GuidePage } from './ui/pages/GuidePage';
import { SupportPage } from './ui/pages/SupportPage';
import { LegalPage } from './ui/pages/LegalPage';

/** Scroll to top on navigation, except for in-page anchors. */
function useScrollReset() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname, hash]);
}

export function App() {
  useScrollReset();
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Editor />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Routes>
        <Route path="/" element={<FaqJsonLd />} />
      </Routes>
    </>
  );
}

function NotFound() {
  return (
    <div className="prose">
      <h1>That page does not exist</h1>
      <p className="updated">Error 404</p>
      <p>
        The link may be out of date. The studio is at <a href="/app">/app</a> and the guide is at{' '}
        <a href="/guide">/guide</a>.
      </p>
    </div>
  );
}
