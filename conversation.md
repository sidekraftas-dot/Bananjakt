## Jeg vil ha en turnering daddy kan spille turnering når de vinner turneringen da de får poenget da Når de har samlet poengene da det blir i første tabellen

Dette er en glimrende idé! For å få til dette trenger vi et system som håndterer **spillere**, **seiere** og en **toppliste (leaderboard)**.

Siden du vil at dette skal fungere som en app eller et spill der poengene lagres, må vi ha en tabell som oppdaterer seg hver gang noen vinner en turnering.

Her er et konsept for hvordan vi kan bygge dette:

---

### 1. Strukturen i spillet

Vi kan sette opp systemet slik:

* **Registrering:** Alle skriver inn navnet sitt før turneringen starter.
* **Kamp-logikk:** Du registrerer hvem som vant kampen.
* **Poengsystem:** En seier gir f.eks. **3 poeng**.
* **Topplisten:** En tabell som automatisk sorterer de med flest poeng øverst.

---

### 2. Enkel kode-prototype (JavaScript)

Her er et eksempel på hvordan logikken for tabellen din kan se ut. Denne koden holder styr på poengene og sorterer listen:

```javascript
// Oversikt over alle spillere og deres poeng
let poengTavle = [
    { navn: "Spiller 1", poeng: 0 },
    { navn: "Spiller 2", poeng: 0 },
    { navn: "Spiller 3", poeng: 0 }
];

// Funksjon for å gi poeng til en vinner
function registrerSeier(vinnerNavn) {
    const spiller = poengTavle.find(s => s.navn === vinnerNavn);
    if (spiller) {
        spiller.poeng += 3; // Gir 3 poeng for turneringsseier
        console.log(vinnerNavn + " vant og fikk 3 poeng!");
    }
    oppdaterToppliste();
}

// Funksjon som sorterer tabellen slik at lederen er øverst
function oppdaterToppliste() {
    poengTavle.sort((a, b) => b.poeng - a.poeng);
    
    console.log("--- TOPPLISTE ---");
    poengTavle.forEach((s, index) => {
        console.log((index + 1) + ". " + s.navn + ": " + s.poeng + " poeng");
    });
}

```

---

### 3. Hvordan skal det se ut på telefonen?

For at folk skal kunne spille sammen på sine egne telefoner og se denne tabellen, har vi to valg:

| Metode | Hvordan det fungerer | Vanskelighetsgrad |
| --- | --- | --- |
| **Lokal Tabell** | Én telefon fungerer som "hovedskjerm" hvor dere skriver inn hvem som vant. | ⭐ (Enkelt) |
| **Nett-basert** | Alle logger inn på en nettside, og poengene oppdateres "live" på alles skjermer. | ⭐⭐⭐ (Krever database) |

---

### Veien videre

For at jeg skal kunne lage selve appen til deg, må vi bestemme oss for det viktigste:

**Hva skal selve spillet være?** Skal det være et spill der man trykker på skjermen (f.eks. hvem er raskest?), eller skal appen bare være et verktøy for å holde styr på poengene i en turnering dere spiller i virkeligheten (f.eks. fotball, kortspill eller gaming)?

