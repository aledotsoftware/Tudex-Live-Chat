// Custom service worker logic to handle notification clicks and interactive replies
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  
  if (event.action === 'reply') {
    const text = event.reply;
    const { chatId, token } = notification.data || {};
    
    if (chatId && text) {
      notification.close();
      
      // Send the reply back to the system via direct API POST call
      event.waitUntil(
        fetch('/api/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            chatId,
            text
          })
        }).then(res => {
          if (!res.ok) {
            console.error("Failed to send reply from notification status:", res.status);
          }
        }).catch(err => {
          console.error("Error sending reply from notification:", err);
        })
      );
    }
  } else {
    // Normal click: open/focus the app
    event.notification.close();
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          // If the app is open, focus its window
          const urlObj = new URL(client.url, self.location.origin);
          if (urlObj.pathname === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        // If not open, open a new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});
