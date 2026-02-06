// Background service worker for API calls

// Get storage value helper
async function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarize(request)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'chat') {
    handleChat(request)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'openChat') {
    // Store page data for chat page to retrieve
    chrome.storage.session.set({ currentPageData: request.pageData });
    // Open chat in new tab
    chrome.tabs.create({ url: 'chat.html' });
    sendResponse({ success: true });
    return true;
  }

  // For streaming to chat page
  if (request.action === 'startStream') {
    handleStreamRequest(request, sender);
    sendResponse({ started: true });
    return true;
  }

  // For streaming to popup
  if (request.action === 'startPopupStream') {
    handlePopupStreamRequest(request);
    sendResponse({ started: true });
    return true;
  }
});

async function handleSummarize(request) {
  const apiKey = await getStorageValue('openai_api_key');
  if (!apiKey) {
    throw new Error('Please set your OpenAI API key in the extension settings');
  }

  const model = await getStorageValue('openai_model') || 'gpt-5.2-pro';

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that summarizes web content clearly and concisely. Use markdown formatting for better readability.'
    },
    {
      role: 'user',
      content: request.prompt
    }
  ];

  // For popup, we'll do non-streaming for simplicity but can be changed
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API request failed');
  }

  const data = await response.json();
  return { result: data.choices[0].message.content };
}

async function handleChat(request) {
  const apiKey = await getStorageValue('openai_api_key');
  if (!apiKey) {
    throw new Error('Please set your OpenAI API key in the extension settings');
  }

  const model = await getStorageValue('openai_model') || 'gpt-5.2-pro';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: request.messages,
      temperature: 0.7,
      max_tokens: 4000,
      stream: false
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API request failed');
  }

  const data = await response.json();
  return { result: data.choices[0].message.content };
}

// Streaming handler for chat page
async function handleStreamRequest(request, sender) {
  const apiKey = await getStorageValue('openai_api_key');
  if (!apiKey) {
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'streamError',
      error: 'Please set your OpenAI API key in the extension settings'
    });
    return;
  }

  const model = await getStorageValue('openai_model') || 'gpt-5.2-pro';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: request.messages,
        temperature: 0.7,
        max_tokens: 4000,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.json();
      chrome.tabs.sendMessage(sender.tab.id, {
        action: 'streamError',
        error: error.error?.message || 'API request failed'
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'streamEnd' });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              chrome.tabs.sendMessage(sender.tab.id, {
                action: 'streamChunk',
                content: content
              });
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    chrome.tabs.sendMessage(sender.tab.id, { action: 'streamEnd' });
  } catch (error) {
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'streamError',
      error: error.message
    });
  }
}

// Streaming handler for popup
async function handlePopupStreamRequest(request) {
  const apiKey = await getStorageValue('openai_api_key');
  if (!apiKey) {
    chrome.runtime.sendMessage({
      action: 'popupStreamError',
      error: 'Please set your OpenAI API key in the extension settings'
    });
    return;
  }

  const model = await getStorageValue('openai_model') || 'gpt-5.2-pro';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: request.messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.json();
      chrome.runtime.sendMessage({
        action: 'popupStreamError',
        error: error.error?.message || 'API request failed'
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            chrome.runtime.sendMessage({ action: 'popupStreamEnd' });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              chrome.runtime.sendMessage({
                action: 'popupStreamChunk',
                content: content
              });
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    chrome.runtime.sendMessage({ action: 'popupStreamEnd' });
  } catch (error) {
    chrome.runtime.sendMessage({
      action: 'popupStreamError',
      error: error.message
    });
  }
}
