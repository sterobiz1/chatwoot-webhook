// api/chatwoot-webhook.js

// Helper function to fetch products from WooCommerce with better filtering
async function fetchWooCommerceProducts(searchQuery = '', category = '', limit = 20) {
  const wcApiUrl = new URL('https://blitzschnell.co/wp-json/wc/v3/products');
  
  // Set query parameters
  wcApiUrl.searchParams.set('per_page', limit.toString());
  wcApiUrl.searchParams.set('status', 'publish');
  
  if (searchQuery) {
    wcApiUrl.searchParams.set('search', searchQuery);
  }
  
  if (category) {
    wcApiUrl.searchParams.set('category', category);
  }

  const wcUser = process.env.WC_CONSUMER_KEY;
  const wcPass = process.env.WC_CONSUMER_SECRET;
  const wcAuth = Buffer.from(`${wcUser}:${wcPass}`).toString('base64');

  try {
    const wcResponse = await fetch(wcApiUrl.toString(), {
      headers: {
        'Authorization': `Basic ${wcAuth}`,
        'Content-Type': 'application/json'
      }
    });

    if (!wcResponse.ok) {
      throw new Error(`WooCommerce API error: ${wcResponse.status} ${wcResponse.statusText}`);
    }

    const products = await wcResponse.json();
    
    // Enhanced product summary with more details
    const productSummary = products.map(p => {
      const cleanDescription = (p.short_description || '').replace(/<[^>]+>/g, '').trim();
      const price = p.price ? `${p.price}€` : 'Preis auf Anfrage';
      const stockStatus = p.stock_status === 'instock' ? '✅ Verfügbar' : '❌ Nicht verfügbar';
      
      return `• ${p.name} (${price}) - ${stockStatus}\n  ${cleanDescription}`;
    }).join('\n\n');

    return {
      success: true,
      products,
      productSummary: productSummary || 'Keine Produkte gefunden.',
      count: products.length
    };
  } catch (error) {
    console.error('WooCommerce fetch error:', error);
    return {
      success: false,
      productSummary: 'Produktinformationen konnten nicht geladen werden.',
      error: error.message,
      count: 0
    };
  }
}

// Helper function to get product by specific ID
async function fetchProductById(productId) {
  const wcApiUrl = `https://blitzschnell.co/wp-json/wc/v3/products/${productId}`;
  const wcUser = process.env.WC_CONSUMER_KEY;
  const wcPass = process.env.WC_CONSUMER_SECRET;
  const wcAuth = Buffer.from(`${wcUser}:${wcPass}`).toString('base64');

  try {
    const wcResponse = await fetch(wcApiUrl, {
      headers: {
        'Authorization': `Basic ${wcAuth}`,
        'Content-Type': 'application/json'
      }
    });

    if (!wcResponse.ok) {
      throw new Error(`Product not found: ${wcResponse.status}`);
    }

    return await wcResponse.json();
  } catch (error) {
    console.error('Product fetch error:', error);
    return null;
  }
}

// Helper function to extract product search intent from message
function extractProductIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // Common product keywords
  const productKeywords = [
    'testosteron', 'test', 'tren', 'trenbolon', 'anavar', 'winstrol', 'dbol',
    'dianabol', 'deca', 'equipoise', 'masteron', 'primo', 'primobolan',
    'hgh', 'wachstumshormon', 'peptid', 'fatburner', 'clenbuterol',
    'medipharma', 'akra labs', 'global pharma', 'steroide', 'tabletten'
  ];
  
  // Extract search terms
  const searchTerms = productKeywords.filter(keyword => 
    lowerMessage.includes(keyword)
  );
  
  return {
    hasProductIntent: searchTerms.length > 0,
    searchTerms,
    searchQuery: searchTerms.join(' ')
  };
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

    // === Enhanced WooCommerce product fetching ===
    console.log("Fetching product information...");
    
    // Extract product intent from message
    const productIntent = extractProductIntent(filterData.message_content);
    console.log("Product intent:", productIntent);
    
    let productData;
    
    if (productIntent.hasProductIntent) {
      // Fetch specific products based on search terms
      console.log("Searching for specific products:", productIntent.searchQuery);
      productData = await fetchWooCommerceProducts(productIntent.searchQuery, '', 15);
    } else {
      // Fetch general product overview (fewer products for general queries)
      console.log("Fetching general product overview");
      productData = await fetchWooCommerceProducts('', '', 8);
    }
    
    console.log(`Product fetch result: ${productData.success ? 'Success' : 'Failed'}, Count: ${productData.count}`);
    
    // === END Enhanced WooCommerce fetch ===

    // Step 2: Call OpenAI API with enhanced product context
    const systemPrompt = `
Du bist ein freundlicher First-Layer-Support-Bot für blitzschnell.co (Steroide, Peptide, Wachstumshormone, Fatburner, Sex Support). 
Beantworte Anfragen zu Produkten, Wirkstoffen, Versand, Zahlung und Datenschutz. Empfehle Produkte aus blitzschnell.co, priorisiere Medipharma (hochwertige Wirkstoffe, höchste Reinheit). 
Antworten kurz, freundlich, nutze Emojis wo passend. Antworte immer auf Deutsch, es sei denn, der Kunde schreibt in einer anderen Sprache.

=== AKTUELLE PRODUKTINFORMATIONEN ===
${productData.productSummary}

${productData.count > 0 ? `(${productData.count} Produkte geladen${productIntent.hasProductIntent ? ' basierend auf deiner Suchanfrage' : ''})` : ''}
=== ENDE PRODUKTINFORMATIONEN ===

Versand: Aus DE: 20€, Einwurf-Einschreiben (DE) oder Paket (EU).
Versand in 24h; Lieferzeit: DE 2-4 Werktage, EU 3-8 Werktage.
Mehrfachkosten bei verschiedenen Marken/Lagern.

Zahlung: Bitcoin, XMR, andere Cryptos; alternativ Ramp.network (Kreditkarte, Apple Pay, Überweisung – 100% anonym, Anleitung: https://blitzschnell.co/zahlungsarten).

**Kontakt & Hilfe:**
- 📱 Telegram: https://t.me/blitzschnell66
- 📞 Signal: https://signal.me/#eu/zx5YbZvzJKj8vGoOvvQfaLyiXrfNxoHzHjXJqYGTMDkPqiuV7e0LYnGjGnvk4BoB (blitzschnell.66)
- 📧 Email: [blitzschnell66@proton.me](mailto:blitzschnell66@proton.me)
- 👥 Telegram-Gruppe: https://t.me/+vnJrRLMOFfdmMDJk

Sonderlösungen möglich.

Datenschutz: Shop nicht greifbar für EU-Behörden; Daten nach 2 Wochen gelöscht.
Keine Anmeldung; nur anonyme Zahlungen für max. IT-Sicherheit.

**Produktempfehlungen:**
- Immer **direkten Produktlink** zu blitzschnell.co/produkt/[produktname] hinzufügen
- Betone konkrete Vorteile (Muskelaufbau, Regeneration, Definition)
- Priorisiere Medipharma (höchste Qualität/Reinheit)
- Zeige **Preis + Verfügbarkeit** wenn verfügbar
- Erwähne **Dosierung/Anwendung** kurz
- Empfehle passende **Stacks** (z.B. Medipharma Ripomed 250 + Akra Labs Akratropin)
- Kategorien: Steroide (Medipharma/Global Pharma), Peptide/HGH (Akra Labs), Fatburner/Tabletten

**Produktantwort-Format:**

🔥 [Produktname] - [Preis]€
✅ [Hauptvorteil] 
🔗 Direkt bestellen: https://blitzschnell.co/produkt/[produktname]
💡 Tipp: [Kurze Anwendungsempfehlung]


Weiterleitung: Bei Unklarheiten (z.B. Dosierungen): Zu Blitz leiten über:
- **Telegram:** https://t.me/blitzschnell66
- **Signal:** https://signal.me/#eu/zx5YbZvzJKj8vGoOvvQfaLyiXrfNxoHzHjXJqYGTMDkPqiuV7e0LYnGjGnvk4BoB
- **Email:** [blitzschnell66@proton.me](mailto:blitzschnell66@proton.me)
- **Telegram-Gruppe:** https://t.me/+vnJrRLMOFfdmMDJk

Paketstatus: Frage nach Bestellnummer; Status in Email. Sonst zu Blitz über obige Kontakte.`;

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
            content: systemPrompt
          },
          {
            role: 'user',
            content: filterData.message_content
          }
        ],
        max_tokens: 600,
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
      original_message: filterData.message_content,
      product_data: {
        intent_detected: productIntent.hasProductIntent,
        search_terms: productIntent.searchTerms,
        products_found: productData.count,
        wc_api_success: productData.success
      }
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}