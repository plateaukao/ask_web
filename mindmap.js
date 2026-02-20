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
      style: (id) => `#${id} { --markmap-text-color: ${isDark ? '#e2e8f0' : '#333'}; --markmap-circle-open-bg: #fff; }`,
    }, root);

    if (markmap.Toolbar) {
      const toolbar = markmap.Toolbar.create(mm);
      toolbar.showBrand = false;
      toolbar.setItems(['zoomIn', 'zoomOut', 'fit', 'recurse']);
      document.getElementById('svg-container').appendChild(toolbar.el);
    }
  } catch (err) {
    document.getElementById('error').style.display = '';
    document.getElementById('error').textContent = 'Failed to render mind map: ' + err.message;
    document.getElementById('svg-container').style.display = 'none';
  }
}

init();
