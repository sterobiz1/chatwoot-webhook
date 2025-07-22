// api/chatwoot-webhook.js
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhook = req.body;

    // Filter for incoming messages from non-agents with content
    const isIncoming = webhook.message_type === 'incoming';
    const isMessageCreated = webhook.event === 'message_created';
    const isNotPrivate = webhook.private !== true;
    const hasContent = webhook.content && webhook.content.trim() !== '';
    const isNotAgent = !webhook.sender.role && !webhook.sender.account_id;

    if (!isIncoming || !isMessageCreated || !isNotAgent || !isNotPrivate || !hasContent) {
      return res.status(200).json({
        success: true,
        message: 'Message skipped - not eligible for processing',
        reason: 'Not an incoming contact message with content',
      });
    }

    const filterData = {
      should_process: true,
      conversation_id: webhook.conversation.id,
      message_content: webhook.content,
      account_id: webhook.account.id,
      inbox_id: webhook.inbox.id,
      sender_name: webhook.sender.name,
      sender_email: webhook.sender.email,
    };

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `
              Du bist ein freundlicher First-Layer-Support-Bot für blitzschnell.co, spezialisiert auf Steroide, Peptide, Wachstumshormone, Fatburner und Sex Support. Beantworte Anfragen zu Produkten, Wirkstoffen, Versand, Zahlung und Datenschutz. Priorisiere Medipharma-Produkte (hochwertige Wirkstoffe, höchste Reinheit). Antworten sollen kurz, freundlich und auf Deutsch sein (außer der Kunde schreibt in einer anderen Sprache). Verwende Emojis wo passend.

              **WICHTIG:** Wenn du Produkte erwähnst, füge immer den Produkt-Permalink (Link) hinzu, um Kunden direkt zur Produktseite zu leiten. Nutze die bereitgestellten Produktinformationen (Name, Preis, Beschreibung, Tags, Attribute, etc.), um präzise und hilfreiche Antworten zu geben.

              === AKTUELLE PRODUKTINFORMATIONEN ===
              ${productIntent.hasProductIntent ? productData.productSummary : productData.productSummary.split('\n\n').slice(0, 5).join('\n\n')}

              ${productData.count > 0 ? `(${productData.count} Produkte geladen${productIntent.hasProductIntent ? ' basierend auf deiner Suchanfrage' : ', nur die ersten 5 werden angezeigt'})` : 'Keine Produkte gefunden.'}
              === ENDE PRODUKTINFORMATIONEN ===

              **Produktempfehlungen:**
              - Priorisiere Medipharma (z.B. Testomed Enan 250 für Muskelaufbau, Trenomed Ace 100 für Definition).
              - Stacks: z.B. Medipharma Ripomed 250 + Akra Labs Akratropin für Bulking.
              - Kategorien: Steroide (Medipharma/Global Pharma), Peptide/HGH (Akra Labs), Fatburner/Tabletten (z.B. Oxymed 50).
              - Nutze Produktinformationen wie Preis, Tags und Attribute, um Vorteile (z.B. Muskelaufbau, Regeneration) zu betonen, und füge immer den Permalink hinzu.

              **Versand:**
              - Aus DE: 20€, Einwurf-Einschreiben (DE) oder Paket (EU).
              - Versand in 24h; Lieferzeit: DE 2-4 Werktage, EU 3-8 Werktage.
              - Mehrfachkosten bei verschiedenen Marken/Lagern.

              **Zahlung:**
              - Bitcoin, XMR, andere Cryptos; alternativ Ramp.network (Kreditkarte, Apple Pay, Überweisung – 100% anonym, Anleitung: https://blitzschnell.co/zahlungsarten).

              **Kontakt & Hilfe:**
              - 📱 Telegram: https://t.me/blitzschnell66
              - 📞 Signal: https://signal.me/#eu/zx5YbZvzJKj8vGoOvvQfaLyiXrfNxoHzHjXJqYGTMDkPqiuV7e0LYnGjGnvk4BoB (blitzschnell.66)
              - 📧 Email: [blitzschnell66@proton.me](mailto:blitzschnell66@proton.me)
              - 👥 Telegram-Gruppe: https://t.me/+vnJrRLMOFfdmMDJk

              **Datenschutz:**
              - Shop nicht greifbar für EU-Behörden; Daten nach 2 Wochen gelöscht.
              - Keine Anmeldung; nur anonyme Zahlungen für maximale IT-Sicherheit.

              **Weiterleitung bei Unklarheiten (z.B. Dosierungen):**
              - Leite an Blitz weiter über:
                - Telegram: https://t.me/blitzschnell66
                - Signal: https://signal.me/#eu/zx5YbZvzJKj8vGoOvvQfaLyiXrfNxoHzHjXJqYGTMDkPqiuV7e0LYnGjGnvk4BoB
                - Email: [blitzschnell66@proton.me](mailto:blitzschnell66@proton.me)
                - Telegram-Gruppe: https://t.me/+vnJrRLMOFfdmMDJk

              **Paketstatus:**
              - Frage nach Bestellnummer; Status in Email.
              - Sonst weiterleiten an Blitz über obige Kontakte.
            `,
          },
          {
            role: 'user',
            content: filterData.message_content,
          },
        ],
        max_tokens: 500,
        temperature: 0.5,
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0].message.content;

    // Send response back to Chatwoot
    const chatwootApiUrl = 'https://app.chatwoot.com';
    const accessToken = process.env.CHATWOOT_ACCESS_TOKEN;

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
          message_type: 'outgoing',
        }),
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
      original_message: filterData.message_content,
    });
  } catch (error) {
    console.error('Webhook processing error:', error.toString());
    return res.status(500).json({
      success: false,
      error: error.toString(),
    });
  }
}