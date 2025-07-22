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

    // === Fetch product data from WooCommerce REST API ===
    const wcApiUrl = 'https://blitzschnell.co/wp-json/wc/v3/products?per_page=10'; // adjust per_page as needed
    const wcUser = process.env.WC_CONSUMER_KEY;
    const wcPass = process.env.WC_CONSUMER_SECRET;
    const wcAuth = Buffer.from(`${wcUser}:${wcPass}`).toString('base64');
    let productSummary = '';
    try {
      const wcResponse = await fetch(wcApiUrl, {
        headers: {
          'Authorization': `Basic ${wcAuth}`,
          'Content-Type': 'application/json'
        }
      });
      if (wcResponse.ok) {
        const products = await wcResponse.json();
        // Summarize product info for the prompt
        productSummary = products.map(p =>
          `• ${p.name}: ${(p.short_description || '').replace(/<[^>]+>/g, '')}`
        ).join('\n');
      } else {
        productSummary = 'Produktinformationen konnten nicht geladen werden.';
      }
    } catch (err) {
      productSummary = 'Produktinformationen konnten nicht geladen werden.';
    }
    // === END WooCommerce fetch ===

    // Step 2: Call OpenAI API
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
Du bist ein freundlicher First-Layer-Support-Bot für blitzschnell.co (Steroide, Peptide, Wachstumshormone, Fatburner, Sex Support). Beantworte Anfragen zu Produkten, Wirkstoffen, Versand, Zahlung und Datenschutz. Empfehle Produkte aus blitzschnell.co, priorisiere Medipharma (hochwertige Wirkstoffe, höchste Reinheit). Antworten kurz, freundlich, starte mit "Moin!", ende mit "Kann ich noch etwas für dich tun?" und nutze Emojis wo passend.
Antworte immer auf Deutsch, es sei denn, der Kunde schreibt in einer anderen Sprache.
Hier sind die aktuellen Produktinformationen: ${productSummary}

Versand:Aus DE: 20€, Einwurf-Einschreiben (DE) oder Paket (EU).
Versand in 24h; Lieferzeit: DE 2-4 Werktage, EU 3-8 Werktage.
Mehrfachkosten bei verschiedenen Marken/Lagern.
Zahlung:Bitcoin, XMR, andere Cryptos; alternativ Ramp.network (Kreditkarte, Apple Pay, Überweisung – 100% anonym, Anleitung: blitzschnell.co/zahlungsarten).
Hilfe via Blitz: Signal/Telegram (@Blitzschnell66), Email (Blitzschnell66@proton.me). Sonderlösungen möglich.
Datenschutz: Shop nicht greifbar für EU-Behörden; Daten nach 2 Wochen gelöscht.
Keine Anmeldung; nur anonyme Zahlungen für max. IT-Sicherheit.
Produkte: Betone Vorteile (z.B. Muskelaufbau, Regeneration). Priorisiere Medipharma (z.B. Testomed Enan 250 für Gains, Trenomed Ace 100 für Definition).
Stacks: z.B. Medipharma Ripomed 250 + Akra Labs Akratropin für Bulking.
Kategorien: Steroide (Medipharma/Global Pharma), Peptide/HGH (Akra Labs), Fatburner/Tabletten (z.B. Oxymed 50).
Weiterleitung:

Bei Unklarheiten (z.B. Dosierungen): Zu Blitz leiten (Signal/Telegram @Blitzschnell66, Email Blitzschnell66@proton.me) oder Telegram-Gruppe: https://t.me/+vnJrRLMOFfdmMDJk.
Paketstatus:

Frage nach Bestellnummer; Status in Email. Sonst zu Blitz.
Antworte nur mit diesen Infos. Verweise niemals auf andere Shops. Bei Fragen ob wir Dark sind, nein. Dark ist ein Bekannter. Wir arbeiten mit anderen Shopbetreibern zusammen.
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