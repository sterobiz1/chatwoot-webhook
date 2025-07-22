import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhook = req.body;

    // Step 1: Filter for messages
    console.log("Webhook content field:", webhook.content);
    console.log("Webhook message_type:", webhook.message_type);
    console.log("Sender object:", webhook.sender);
    console.log("Event type:", webhook.event);

    const isIncoming = webhook.message_type === 'incoming';
    const isMessageCreated = webhook.event === 'message_created';
    const isNotPrivate = webhook.private !== true;
    const hasContent = webhook.content && webhook.content.trim() !== '';
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

    // Step 2: Read and parse products.json
    const productsFilePath = path.join(process.cwd(), 'data', 'products.json');
    let products;
    try {
      const productsData = fs.readFileSync(productsFilePath, 'utf-8');
      products = JSON.parse(productsData);
    } catch (error) {
      console.error('Error reading or parsing products.json:', error);
      products = []; // Fallback to empty array if file read fails
    }

    // Step 3: Extract keywords from user message
    const keywords = filterData.message_content.toLowerCase().split(/\s+/);

    // Step 4: Filter relevant products
    const relevantProducts = products.filter(product => {
      const productText = [
        product.name,
        product.description,
        ...(product.attributes ? product.attributes.flatMap(attr => attr.options) : [])
      ].join(' ').toLowerCase();
      return keywords.some(keyword => productText.includes(keyword));
    }).slice(0, 3); // Limit to top 3 products

    // Step 5: Build product context for OpenAI prompt
    const productContext = relevantProducts.length
      ? relevantProducts.map(p => {
          const cleanDescription = p.description.replace(/<[^>]*>/g, ''); // Remove HTML tags
          const priceInfo = p.sale_price && p.sale_price < p.regular_price
            ? `€${p.sale_price} (Normalpreis: €${p.regular_price})`
            : `€${p.price}`;
          return `${p.name} - ${priceInfo}\nBeschreibung: ${cleanDescription.slice(0, 100)}...\nLink: ${p.permalink}`;
        }).join('\n\n')
      : 'Keine passenden Produkte gefunden.';

    // Step 6: Call OpenAI API with updated system prompt
    const systemPrompt = `
      Du bist ein First-Layer-Support-Bot für blitzschnell.co, einem Webshop spezialisiert auf Steroide, Peptide, Wachstumshormone, Fatburner und Sex Support. 
      Beantworte Anfragen zu Produkten, Wirkstoffen, Versand, Zahlung und Datenschutz. Priorisiere Medipharma-Produkte (hochwertige Wirkstoffe, höchste Reinheit). 
      Antworten sollen kurz, freundlich und auf Deutsch sein (außer der Kunde schreibt in einer anderen Sprache). Vermeide "Sie/Ihnen" und benutze du/dir stattdessen. 
      Verwende Emojis wo passend. 😊

      **Produktempfehlungen:**
      - Priorisiere Medipharma (z.B. Testomed Enan 250 für Muskelaufbau, Trenomed Ace 100 für Definition).
      - Stacks: z.B. Medipharma Ripomed 250 + Akra Labs Akratropin für Bulking.
      - Kategorien: Steroide (Medipharma/Global Pharma), Peptide/HGH (Akra Labs), Fatburner/Tabletten (z.B. Oxymed 50).
      - Nutze die folgenden Produktinformationen, um Vorteile (z.B. Muskelaufbau, Regeneration) zu betonen, und füge immer den Permalink hinzu:
      ${productContext}

      **Versand:**
      - Aus DE: 20€, Einwurf-Einschreiben (DE) oder Paket (EU).
      - Versand in 24h4200h; Lieferzeit: DE 2-4 Werktage, EU 3-8 Werktage.
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
    `;

    console.log("Processing message:", filterData.message_content);

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
            content: systemPrompt
          },
          {
            role: 'user',
            content: filterData.message_content
          }
        ],
        max_tokens: 500,
        temperature: 0.5
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0].message.content;

    console.log("AI Response:", aiResponse);

    // Step 7: Send response back to Chatwoot
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