// api/chatwoot-webhook.js
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhook = req.body;
    
    // Step 1: Filter for messages (same logic as your Pipedream filter)
    console.log("Webhook content field:", webhook.content);
    console.log("Webhook message_type:", webhook.message_type);
    console.log("Sender object:", webhook.sender);
    console.log("Event type:", webhook.event);
    
    // Check each condition individually
    const isIncoming = webhook.message_type === 'incoming';
    const isMessageCreated = webhook.event === 'message_created';
    const isNotPrivate = webhook.private !== true;
    const hasContent = webhook.content && webhook.content.trim() !== '';
    
    // For contacts, the sender won't have certain agent-specific fields
    // Let's check if this is NOT an agent by looking for agent-specific indicators
    const isNotAgent = !webhook.sender.role && !webhook.sender.account_id;
    
    console.log("Conditions check:");
    console.log("- Is incoming:", isIncoming);
    console.log("- Is message created event:", isMessageCreated);
    console.log("- Is not agent:", isNotAgent);
    console.log("- Is not private:", isNotPrivate);
    console.log("- Has content:", hasContent);
    
    const shouldProcess = isIncoming && isMessageCreated && isNotAgent && isNotPrivate && hasContent;
    
    if (!shouldProcess) {
      console.log("Skipping message - not eligible for processing");
      return res.status(200).json({
        success: true,
        message: "Message skipped - not eligible for processing",
        reason: "Not an incoming contact message with content"
      });
    }

    console.log("Processing message:", webhook.content);

    const filterData = {
      should_process: true,
      conversation_id: webhook.conversation.id,
      message_content: webhook.content,
      account_id: webhook.account.id,
      inbox_id: webhook.inbox.id,
      sender_name: webhook.sender.name,
      sender_email: webhook.sender.email
    };

    // Step 2: Call OpenAI API
    console.log("Processing message:", filterData.message_content);
    
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `
Du bist ein KI-Chatbot für den Onlineshop "Blitzschnell.co".
Antworte immer auf Deutsch, es sei denn, der Kunde schreibt in einer anderen Sprache.
Deine Aufgaben:
- Hilf Kunden bei Fragen zu Produkten, Bestellungen, Versand, Rückgabe und Zahlungen.
- Nutze folgende Informationsquellen:
  • Versandinformationen: https://blitzschnell.co/versand
  • Zahlungsarten: https://www.blitzschnell.co/zahlungsarten/
  • Wissen über Produkte enteweder aus dem Blog: https://www.blitzschnell.co/wissen/ oder aus der 
    Produktbeschreibung von der Produktseite (Beispiel: https://www.blitzschnell.co/shop/injektionen/10x-boldenone-undecylenate/) Produkte benutzen die standard WooCommerce felder für
- Wenn du eine Frage nicht beantworten kannst, bitte den Kunden, sich an den menschlichen Support auf Telegram oder Signal zu wenden.
- Sei stets freundlich, professionell und fasse dich kurz.
- Gib keine Informationen weiter, die nicht auf den oben genannten Seiten stehen.
- Frage bei Bestell- oder Supportanfragen immer nach der Bestellnummer.
`
          },
          {
            role: 'user',
            content: filterData.message_content
          }
        ],
        max_tokens: 500,
        temperature: 0.2
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0].message.content;

    console.log("AI Response:", aiResponse);

    // Step 3: Send response back to Chatwoot
    const chatwootApiUrl = "https://app.chatwoot.com";
    const accessToken = process.env.CHATWOOT_ACCESS_TOKEN;

    console.log("Sending AI response to Chatwoot:", aiResponse);
    
    const chatwootResponse = await fetch(
      `${chatwootApiUrl}/api/v1/accounts/${filterData.account_id}/conversations/${filterData.conversation_id}/messages`,
      {
        method: 'POST',
        headers: {
          'api_access_token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: aiResponse,
          message_type: 'outgoing'
        })
      }
    );

    if (!chatwootResponse.ok) {
      throw new Error(`Chatwoot API error: ${chatwootResponse.status}`);
    }

    const chatwootData = await chatwootResponse.json();

    return res.status(200).json({
      success: true,
      message_sent: aiResponse,
      chatwoot_response: chatwootData,
      original_message: filterData.message_content
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}