import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/* WCAG 2.4.2 and 2.4.3 (NFR-7): after each page change, the browser tab is named after the page's heading
   ("Post an item · FoundU"), and the focus moves to that heading, so a screen reader announces the new page. */
export default function PageTitle() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    let tries = 0;
    let timer;
    const apply = () => {
      const h1 = document.querySelector('main h1, .join-page h1, .tag-public h1, .auth-form h2');
      if (!h1 && tries++ < 20) { timer = setTimeout(apply, 100); return; } // the page may still be loading
      document.title = h1 ? `${h1.textContent.trim()} · FoundU` : 'FoundU';
      if (!first.current && h1) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
      first.current = false;
    };
    apply();
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
