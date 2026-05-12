async function init() {
  // Apply stored theme first to avoid flash
  const theme = await getTheme();
  applyTheme(theme);

  const { mindmapContent } = await chrome.storage.session.get('mindmapContent');
  if (!mindmapContent) {
    document.getElementById('error').style.display = '';
    document.getElementById('error').textContent = 'No content found. Please open a mind map from the Ask Web panel.';
    document.getElementById('svg-container').style.display = 'none';
    return;
  }

  // Use first heading as page title if available
  const headingMatch = mindmapContent.match(/^#{1,3}\s+(.+)/m);
  if (headingMatch) document.title = headingMatch[1] + ' – Mind Map';

  try {
    const transformer = new markmap.Transformer();
    const { root } = transformer.transform(mindmapContent);
    const svg = document.getElementById('mindmap');

    // Override markmap's embedded CSS vars to match current theme
    const isDark = theme !== 'light';
    const mm = markmap.Markmap.create(svg, {
      autoFit: true,
      initialExpandLevel: 3,
      style: (id) => `#${id} { --markmap-text-color: ${isDark ? '#e2e8f0' : '#333'}; --markmap-circle-open-bg: #fff; }`,
    }, root);

    if (markmap.Toolbar) {
      const toolbar = markmap.Toolbar.create(mm);
      toolbar.showBrand = false;
      toolbar.register({
        id: 'copyPng',
        title: 'Copy as PNG',
        content: markmap.Toolbar.icon('M5 5V3H15V13H13M3 5H13V15H3Z', { stroke: 'currentColor', fill: 'none', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        onClick: (e) => {
          const button = e.target.closest('.mm-toolbar-item');
          const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1e1e2e';
          // Call clipboard.write synchronously to retain user activation;
          // the PNG Blob resolves later via the Promise passed to ClipboardItem.
          copySvgToClipboardAsPng(svg, bg)
            .then(() => flashTitle(button, 'Copied!', 'Copy as PNG', 1200))
            .catch((err) => {
              console.error('Copy mind map failed', err);
              flashTitle(button, 'Copy failed: ' + (err.message || err.name || 'unknown'), 'Copy as PNG', 4000);
            });
        },
      });
      toolbar.setItems(['zoomIn', 'zoomOut', 'fit', 'recurse', 'copyPng']);
      document.getElementById('svg-container').appendChild(toolbar.el);
    }
  } catch (err) {
    document.getElementById('error').style.display = '';
    document.getElementById('error').textContent = 'Failed to render mind map: ' + err.message;
    document.getElementById('svg-container').style.display = 'none';
  }
}

function flashTitle(el, message, defaultTitle, ms) {
  if (!el) return;
  el.title = message;
  setTimeout(() => { el.title = defaultTitle; }, ms);
}

init();
