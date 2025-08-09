// api/chatwoot-webhook.js
const fs = require('fs');
const path = require('path');

// Load product data
function loadProducts() {
  try {
    const productsPath = path.join(process.cwd(), 'data', 'products.json');
    const productsData = fs.readFileSync(productsPath, 'utf-8');
    return JSON.parse(productsData);
  } catch (error) {
    console.error('Error loading products:', error);
    return [];
  }
}

// Normalize product object to a unified schema so search/formatting is robust
function normalizeProduct(raw) {
  const name = (raw.name || raw.titel || '').toString();
  const beschreibung = (raw.beschreibung || raw.description || '').toString();
  const kurzbeschreibung = (raw.kurzbeschreibung || raw.short_description || '').toString();

  // Kategorien can be a string or an array in our sources
  let kategorien = '';
  if (Array.isArray(raw.kategorien)) {
    kategorien = raw.kategorien.join(', ');
  } else if (Array.isArray(raw.categories)) {
    kategorien = raw.categories.join(', ');
  } else {
    kategorien = (raw.kategorien || raw.categories || '').toString();
  }

  const hersteller = (raw.hersteller || raw.manufacturer || '').toString();
  const wirkstoff = (raw.wirkstoff || raw.active_ingredient || '').toString();
  const traegerstoff = (raw['trägerstoff'] || raw.trägerstoff || raw.carrier || '').toString();
  const angebotspreis = raw.angebotspreis ?? raw.sale_price ?? null;
  const regulaererPreis = raw['regulärer_preis'] ?? raw.price ?? null;
  const permalink = (raw.permalink || '').toString();

  return {
    name,
    beschreibung,
    kurzbeschreibung: kurzbeschreibung || beschreibung,
    kategorien,
    hersteller,
    wirkstoff,
    traegerstoff,
    angebotspreis,
    regulaerer_preis: regulaererPreis,
    permalink,
  };
}

// Search products based on query
function searchProducts(query, products) {
  const searchTerm = query.toLowerCase();
  const medipharmaResults = [];
  const otherResults = [];
  
  // Split query into individual words for better matching
  const searchWords = searchTerm.split(' ').filter(word => word.length > 2);
  
  for (const rawProduct of products) {
    const product = normalizeProduct(rawProduct);
    const searchableText = [
      product.name,
      product.kurzbeschreibung,
      product.beschreibung,
      product.kategorien,
      product.hersteller,
      product.wirkstoff,
      product.traegerstoff
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    
    // Check if any search word matches
    let matchFound = false;
    for (const word of searchWords) {
      if (searchableText.includes(word)) {
        matchFound = true;
        break;
      }
    }
    
    // Also check if the full search term is included
    if (searchableText.includes(searchTerm) || matchFound) {
      // Prioritize Medipharma products
      if ((product.hersteller || '').toLowerCase().includes('medi pharma')) {
        medipharmaResults.push(product);
      } else {
        otherResults.push(product);
      }
    }
  }
  
  // If no results, try broader search for common terms
  if (medipharmaResults.length === 0 && otherResults.length === 0) {
    const commonTerms = {
      'testosteron': ['testosteron', 'testo', 'enanthate', 'propionate', 'cypionate'],
      'peptide': ['peptide', 'ghrp', 'hgh', 'growth hormone'],
      'steroide': ['steroide', 'steroid', 'anabol', 'injektion'],
      'tabletten': ['tabletten', 'tablet', 'oral'],
      'fatburner': ['fatburner', 'clenbuterol', 'clen', 'fat burner']
    };
    
    for (const [category, terms] of Object.entries(commonTerms)) {
      if (searchTerm.includes(category) || terms.some(term => searchTerm.includes(term))) {
        const categoryProducts = products
          .map(normalizeProduct)
          .filter(p =>
            (p.kategorien || '').toLowerCase().includes(category) ||
            (p.wirkstoff || '').toLowerCase().includes(category)
          );
        
        // Separate Medipharma from other products in category search
        const medipharmaCategory = categoryProducts.filter(p =>
          (p.hersteller || '').toLowerCase().includes('medi pharma')
        );
        const otherCategory = categoryProducts.filter(p =>
          !(p.hersteller || '').toLowerCase().includes('medi pharma')
        );
        
        medipharmaResults.push(...medipharmaCategory.slice(0, 3));
        otherResults.push(...otherCategory.slice(0, 2));
        break;
      }
    }
  }
  
  // Combine results with Medipharma products first, then others
  const combinedResults = [...medipharmaResults, ...otherResults];
  return combinedResults.slice(0, 5); // Return top 5 matches with Medipharma prioritized
}

// Format product information for AI
function formatProductInfo(products) {
  if (products.length === 0) return '';
  
  let formatted = '\n\n**PRODUKTINFORMATIONEN - VERWENDE NUR DIESE EXAKTEN LINKS:**\n';
  formatted += '**WICHTIG: Kopiere die Links exakt wie sie hier stehen. Generiere KEINE eigenen URLs!**\n';
  
  products.forEach(raw => {
    const product = normalizeProduct(raw);
    const price = product.angebotspreis || product.regulaerer_preis;
    const priceText = price ? `€${price}` : 'Preis auf Anfrage';
    
    formatted += `\n**${product.name}** (${priceText})\n`;
    formatted += `- Hersteller: ${product.hersteller}\n`;
    formatted += `- Wirkstoff: ${product.wirkstoff}\n`;
    formatted += `- Kategorien: ${product.kategorien}\n`;
    if (product.permalink) {
      formatted += `- EXAKTER LINK ZUM KOPIEREN:\n${product.permalink}\n`;
    }
    formatted += `- Beschreibung: ${product.kurzbeschreibung}\n`;
  });
  
  return formatted;
}

async function readRequestBody(req) {
  // If body already parsed by runtime
  if (req.body) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  // Fallback: read stream
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhook = await readRequestBody(req);
    
    // Step 1: Filter for messages (same logic as your Pipedream filter)
    console.log("Webhook content field:", webhook.content);
    console.log("Webhook message_type:", webhook.message_type);
    console.log("Sender object:", webhook.sender);
    console.log("Event type:", webhook.event);
    
    // Check each condition individually
    const isIncoming = webhook.message_type === 'incoming';
    const isMessageCreated = webhook.event === 'message_created';
    const isNotPrivate = webhook.private !== true;
    const hasContent = typeof webhook.content === 'string' && webhook.content.trim() !== '';
    
    // For contacts, the sender won't have certain agent-specific fields
    // Let's check if this is NOT an agent by looking for agent-specific indicators
    const sender = webhook.sender || {};
    const senderType = (sender.type || '').toLowerCase();
    const isNotAgent = senderType !== 'agent' && !sender.role && !sender.account_id;
    
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
    
    // Debug: Check if we have testosterone products
    const testosteronProducts = products
      .map(normalizeProduct)
      .filter(p => 
        (p.name || '').toLowerCase().includes('testosteron') || 
        (p.wirkstoff || '').toLowerCase().includes('testosteron')
      );
    console.log(`Found ${testosteronProducts.length} testosterone products in database`);
    if (testosteronProducts.length > 0) {
      console.log('Sample testosterone products:', testosteronProducts.slice(0, 2).map(p => `${p.name} - ${p.permalink}`));
    }

    // Search for relevant products based on user message
    const relevantProducts = searchProducts(filterData.message_content, products);
    console.log(`Found ${relevantProducts.length} relevant products`);
    
    // Debug: Log what products were found
    if (relevantProducts.length > 0) {
      console.log('Found products:', relevantProducts.map(p => p.name));
    } else {
      console.log('No products found for query:', filterData.message_content);
      // Try a broader search for "testosteron"
      const testosteronProducts = products
        .map(normalizeProduct)
        .filter(p => 
          (p.name || '').toLowerCase().includes('testosteron') || 
          (p.wirkstoff || '').toLowerCase().includes('testosteron') ||
          (p.kategorien || '').toLowerCase().includes('testosteron')
        );
      console.log(`Found ${testosteronProducts.length} testosterone products in total`);
    }

    // Format product information for AI
    let productsToShow = relevantProducts;
    
    // If no products found, include some popular testosterone products as fallback
    if (relevantProducts.length === 0) {
      console.log('No products found, using fallback search...');
      
      // Try multiple fallback strategies with Medipharma prioritization
      let medipharmaFallback = [];
      let otherFallback = [];
      
      // Strategy 1: Look for testosterone products, prioritizing Medipharma
      const testosteronProducts = products
        .map(normalizeProduct)
        .filter(p => 
          (p.name || '').toLowerCase().includes('testosteron') || 
          (p.wirkstoff || '').toLowerCase().includes('testosteron') ||
          (p.kategorien || '').toLowerCase().includes('testosteron')
        );
      
      // Separate Medipharma testosterone products
      medipharmaFallback = testosteronProducts.filter(p => 
        (p.hersteller || '').toLowerCase().includes('medi pharma')
      );
      otherFallback = testosteronProducts.filter(p => 
        !(p.hersteller || '').toLowerCase().includes('medi pharma')
      );
      
      // Strategy 2: If no testosterone products, look for any Medipharma products
      if (medipharmaFallback.length === 0) {
        medipharmaFallback = products
          .map(normalizeProduct)
          .filter(p => (p.hersteller || '').toLowerCase().includes('medi pharma'));
      }
      
      // Strategy 3: If still no results, just take first few products
      if (medipharmaFallback.length === 0 && otherFallback.length === 0) {
        const normalizedAll = products.map(normalizeProduct);
        const allMedipharma = normalizedAll.filter(p => (p.hersteller || '').toLowerCase().includes('medi pharma'));
        const allOthers = normalizedAll.filter(p => !(p.hersteller || '').toLowerCase().includes('medi pharma'));
        
        medipharmaFallback = allMedipharma.slice(0, 2);
        otherFallback = allOthers.slice(0, 1);
      }
      
      // Combine with Medipharma products first
      const combinedFallback = [...medipharmaFallback, ...otherFallback];
      if (combinedFallback.length > 0) {
        productsToShow = combinedFallback.slice(0, 3);
        console.log('Using fallback products:', productsToShow.map(p => p.name));
      }
    }
    
    const productInfo = formatProductInfo(productsToShow);
    console.log('Product info being sent to AI:', productInfo.substring(0, 200) + '...');

    // Step 2: Call OpenAI API
    console.log("Processing message:", filterData.message_content);

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }
    const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: 'system',
            content: 'Du bist ein First-Layer-Support-Bot für stero.biz, einem Webshop spezialisiert auf Steroide, Peptide, Wachstumshormone, Fatburner und Sex Support. Beantworte Anfragen zu Produkten, Wirkstoffen, Versand, Zahlung und Datenschutz. Priorisiere Medipharma-Produkte (hochwertige Wirkstoffe, höchste Reinheit). Antworten sollen kurz, freundlich und auf Deutsch sein (außer der Kunde schreibt in einer anderen Sprache). Vermeide "Sie/Ihnen" und benutze du/dir stattdessen, etc. Verwende ausschließlich diese emojis: 🍆, 🗲, 🔥, 💯 & 💪 . Halte dich immer kurz und formatiere die Antworten. ' +
         '**Produktempfehlungen:** ' +
         '- Priorisiere IMMER Produkte vom Hersteller Medipharma (höchste Qualität, beste Reinheit). Erwähne ausschließlich Marken die in der products.json unter hersteller stehen. ' +
         '- Wenn Medipharma-Produkte verfügbar sind, empfehle diese zuerst. ' +
         '- Nutze die bereitgestellten Produktinformationen, um spezifische Empfehlungen zu geben und verwende AUSSCHLIESSLICH die exakten Permalinks aus den Produktinformationen. ' +
         '**Versand:** ' +
         '- Aus DE: 20€, Einwurf-Einschreiben (DE) oder Paket (EU). ' +
         '- Versand in 24h; Lieferzeit: DE 2-4 Werktage, EU 3-8 Werktage. ' +
         '- Mehrfachkosten bei verschiedenen Marken/Lagern. ' +
         '**Zahlung:** ' +
         '- Bitcoin, XMR, andere Cryptos; alternativ Ramp.network (Kreditkarte, Apple Pay, Überweisung – 100% anonym. ' +
         '**Kontakt & Hilfe:** ' +
         '- 📱 Telegram: https://t.me/sterobiz66 ' +
         '- 📧 Email: [info@stero.biz](mailto:info@stero.biz) ' +
         '**Datenschutz:** ' +
         '- Shop nicht greifbar für EU-Behörden; Daten nach 2 Wochen gelöscht. ' +
         '- Keine Anmeldung; nur anonyme Zahlungen für maximale IT-Sicherheit. ' +
         '**Weiterleitung bei Unklarheiten (z.B. Dosierungen):** ' +
         '**Paketstatus:** ' +
         '- Frage nach Bestellnummer; Status in Email. ' +
         '- Sonst weiterleiten über obige Kontakte.' +
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

    let aiResponse = '';
    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text().catch(() => '');
      console.error('OpenAI API error:', openaiResponse.status, errText);
    } else {
      try {
        const openaiData = await openaiResponse.json();
        aiResponse = openaiData?.choices?.[0]?.message?.content || '';
      } catch (parseErr) {
        console.error('Failed to parse OpenAI response JSON:', parseErr);
      }
    }

    if (!aiResponse || aiResponse.trim() === '') {
      aiResponse = `Danke für deine Nachricht: "${filterData.message_content}"

Ich helfe dir gleich mit passenden Empfehlungen 💪`;
    }

    console.log("AI Response:", aiResponse);

    // Step 3: Send response back to Chatwoot
    const chatwootApiUrl = process.env.CHATWOOT_BASE_URL || "https://app.chatwoot.com";
    const accessToken = process.env.CHATWOOT_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('Missing CHATWOOT_ACCESS_TOKEN');
    }

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