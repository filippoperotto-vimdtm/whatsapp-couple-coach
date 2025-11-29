import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import OpenAI from "openai";

const app = express();

// Twilio manda i dati come form-url-encoded
app.use(bodyParser.urlencoded({ extended: false }));

// Client Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Client OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Numeri e config
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; // es. "whatsapp:+14155238886"
const PARTNER1 = process.env.PARTNER1_NUMBER; // es. "whatsapp:+39..."
const PARTNER2 = process.env.PARTNER2_NUMBER; // es. "whatsapp:+39..."

let history = []; // memoria in RAM (basta per la demo)

function labelFor(from) {
  if (from === PARTNER1) return "Partner A";
  if (from === PARTNER2) return "Partner B";
  return "Partner";
}

function otherParticipant(from) {
  if (from === PARTNER1) return PARTNER2;
  if (from === PARTNER2) return PARTNER1;
  return null;
}

app.post("/whatsapp", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  console.log("Messaggio in arrivo da", from, ":", body);

  if (!from || !body) {
    res.status(200).send("ok");
    return;
  }

  const label = labelFor(from);
  const other = otherParticipant(from);

  // Salvo nella storia
  history.push({ role: "user", content: `${label}: ${body}` });
  history = history.slice(-10); // ultimi 10 messaggi

  // 1) inoltra il messaggio umano all'altro partner (per simulare il gruppo)
  if (other && other !== from) {
    try {
      await twilioClient.messages.create({
        from: TWILIO_WHATSAPP_NUMBER,
        to: other,
        body: `${label}: ${body}`,
      });
    } catch (err) {
      console.error("Errore inoltro all'altro partner:", err.message);
    }
  }

  // 2) chiama OpenAI per la risposta del coach
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
  {
    role: "system",
    content: `
Sei un coach di coppia che lavora in una chat WhatsApp con due partner, chiamati "Partner A" e "Partner B".
Obiettivo: aiutarli a comunicare meglio, chiarire i conflitti e prendere piccoli impegni concreti, SENZA fare diagnosi cliniche.

Linee guida:
- Tono: calmo, empatico, non giudicante, diretto.
- Lunghezza: massimo 6–8 frasi per risposta. Evita muri di testo.
- Bilanciamento: rivolgiti sempre a entrambi, non prendere le parti di uno solo.
- Fai spesso DOMANDE brevi e mirate che li aiutino a chiarire cosa provano e cosa vogliono.
- Riformula ciò che dicono ("se ho capito bene...") per mostrare che li hai ascoltati.
- Quando c'è conflitto, aiuta a:
  - rallentare,
  - nominare le emozioni,
  - distinguere bisogni e accuse,
  - cercare un piccolo passo concreto che entrambi possono fare.
- Proponi spesso piccoli "esperimenti" o "compiti" molto semplici (es. "questa settimana, una volta, provate a...").
- Se emergono temi gravi (violenza, rischio per sé o per altri, disturbi gravi), NON dare consigli medici o legali.
  Invece:
  - invita con fermezza a cercare aiuto professionale (psicologo, medico, servizi di emergenza),
  - evita di dare istruzioni specifiche su farmaci, diagnosi o piani di sicurezza.
- Se i messaggi sono vaghi, chiedi di specificare prima di dare consigli.

Rispondi sempre in italiano, nella stessa forma (tu/voi) che usano loro, e firma implicitamente come "coach" ma senza usare un nome proprio.
    `.trim(),
  },
  ...history,
],

      max_tokens: 300,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log("Risposta coach:", reply);

    history.push({ role: "assistant", content: reply });

    // 3) invia la risposta del coach a entrambi i partner
    const recipients = [PARTNER1, PARTNER2].filter(Boolean);

    await Promise.all(
      recipients.map((to) =>
        twilioClient.messages.create({
          from: TWILIO_WHATSAPP_NUMBER,
          to,
          body: reply,
        })
      )
    );
  } catch (err) {
    console.error("Errore OpenAI o invio risposta:", err.message);
  }

  // Twilio vuole comunque una risposta HTTP 200
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
