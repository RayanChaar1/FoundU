/* eslint-disable no-var -- this file runs in browsers older than ES2015 */
/* NFR-8.1: runs only in browsers without JavaScript modules (for example Internet Explorer 11), which cannot run
   FoundU, and tells the user which browsers to use.  Plain ES5 on purpose. */
(function () {
  var root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '<div style="max-width:36em;margin:3em auto;padding:0 1em;font-family:Arial,sans-serif;line-height:1.5">' +
    '<h1>Your browser is not supported</h1>' +
    '<p>FoundU works in the latest two versions of Chrome, Safari, Firefox, and Edge, on a computer or a phone.  ' +
    'Open this page in one of them.</p></div>';
})();
