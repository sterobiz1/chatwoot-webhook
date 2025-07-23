// api/chatwoot-webhook.js
import fs from 'fs';
import path from 'path';

// Load product data
function loadProducts() {
  try {
    const productsPath = path.join(process.cwd(), 'data', 'products_reduced.json');
    const productsData = fs.readFileSync(productsPath, 'utf-8');
    return JSON.parse(productsData);
  } catch (error) {
    console.error('Error loading products:', error);
    return [];
  }
}

// Search products based on query
function searchProducts(query, products) {
  const searchTerm = query.toLowerCase();
  const results = [];
  
  for (const product of products) {
    const searchableText = [
      product.name,
      product.kurzbeschreibung,
      product.beschreibung,
      product.kategorien,
      product.hersteller,
      product.wirkstoff,
      product.trägerstoff
    ].join(' ').toLowerCase();
    
    if (searchableText.includes(searchTerm)) {
      results.push(product);
    }
  }
  
  return results.slice(0, 5); // Return top 5 matches
}

// Format product information for AI
function formatProductInfo(products) {
  if (products.length === 0) return '';
  
  let formatted = '\n\n**Verfügbare Produkte:**\n';
  
  products.forEach(product => {
    const price = product.angebotspreis || product.regulärer_preis;
    const priceText = price ? `€${price}` : 'Preis auf Anfrage';
    
    formatted += `\n**${product.name}** (${priceText})\n`;
    formatted += `- Hersteller: ${product.hersteller}\n`;
    formatted += `- Wirkstoff: ${product.wirkstoff}\n`;
    formatted += `- Kategorien: ${product.kategorien}\n`;
    formatted += `- Link: ${product.permalink}\n`;
    formatted += `- Beschreibung: ${product.kurzbeschreibung}\n`;
  });
  
  return formatted;
}

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

    // Load product data
    const products = loadProducts();
    console.log(`Loaded ${products.length} products`);

    // Search for relevant products based on user message
    const relevantProducts = searchProducts(filterData.message_content, products);
    console.log(`Found ${relevantProducts.length} relevant products`);

    // Format product information for AI
    const productInfo = formatProductInfo(relevantProducts);

    // Step 2: Call OpenAI API
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
            content: 'Du bist ein First-Layer-Support-Bot für blitzschnell.co, einem Webshop spezialisiert auf Steroide, Peptide, Wachstumshormone, Fatburner und Sex Support. Beantworte Anfragen zu Produkten, Wirkstoffen, Versand, Zahlung und Datenschutz. Priorisiere Medipharma-Produkte (hochwertige Wirkstoffe, höchste Reinheit). Antworten sollen kurz, freundlich und auf Deutsch sein (außer der Kunde schreibt in einer anderen Sprache). Vermeide "Sie/Ihnen" und benutze du/dir stattdessen, etc. Verwende Emojis wo passend. ' +
         '**Produktempfehlungen:** ' +
         '- Priorisiere Medipharma (z.B. Testomed Enan 250 für Muskelaufbau, Trenomed Ace 100 für Definition). ' +
         '- Stacks: z.B. Medipharma Ripomed 250 + Akra Labs Akratropin für Bulking. ' +
         '- Kategorien: Steroide (Medipharma/Global Pharma), Peptide/HGH (Akra Labs), Fatburner/Tabletten (z.B. Oxymed 50). ' +
         '- Nutze die bereitgestellten Produktinformationen, um spezifische Empfehlungen zu geben und füge immer den Permalink hinzu. ' +
         '**Versand:** ' +
         '- Aus DE: 20€, Einwurf-Einschreiben (DE) oder Paket (EU). ' +
         '- Versand in 24h; Lieferzeit: DE 2-4 Werktage, EU 3-8 Werktage. ' +
         '- Mehrfachkosten bei verschiedenen Marken/Lagern. ' +
         '**Zahlung:** ' +
         '- Bitcoin, XMR, andere Cryptos; alternativ Ramp.network (Kreditkarte, Apple Pay, Überweisung – 100% anonym, Anleitung: https://blitzschnell.co/zahlungsarten). ' +
         '**Kontakt & Hilfe:** ' +
         '- 📱 Telegram: https://t.me/blitzschnell66 ' +
         '- 📞 Signal: https://signal.me/#eu/zx5YbZvzJKj8vGoOvvQfaLyiXrfNxoHzHjXJqYGTMDkPqiuV7e0LYnGjGnvk4BoB (blitzschnell.66) ' +
         '- 📧 Email: [blitzschnell66@proton.me](mailto:blitzschnell66@proton.me) ' +
         '- 👥 Telegram-Gruppe: https://t.me/+vnJrRLMOFfdmMDJk ' +
         '**Datenschutz:** ' +
         '- Shop nicht greifbar für EU-Behörden; Daten nach 2 Wochen gelöscht. ' +
         '- Keine Anmeldung; nur anonyme Zahlungen für maximale IT-Sicherheit. ' +
         '**Weiterleitung bei Unklarheiten (z.B. Dosierungen):** ' +
         '- Leite an Blitz weiter über: ' +
         '  - Telegram: https://t.me/blitzschnell66 ' +
         '  - Signal: https://signal.me/#eu/zx5YbZvzJKj8vGoOvvQfaLyiXrfNxoHzHjXJqYGTMDkPqiuV7e0LYnGjGnvk4BoB ' +
         '  - Email: [blitzschnell66@proton.me](mailto:blitzschnell66@proton.me) ' +
         '  - Telegram-Gruppe: https://t.me/+vnJrRLMOFfdmMDJk ' +
         '**Paketstatus:** ' +
         '- Frage nach Bestellnummer; Status in Email. ' +
         '- Sonst weiterleiten an Blitz über obige Kontakte.' +
         productInfo
          },
          {
            role: 'user',
            content: filterData.message_content
          }
        ],
        max_tokens: 800,
        temperature: 0.5
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
      original_message: filterData.message_content,
      products_found: relevantProducts.length
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}