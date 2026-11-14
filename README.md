# BSB Travel

A private family trip app that installs on the iPhone home screen and works offline.

- **Today**: countdowns, where we are and what is next
- **Plan**: day-by-day itinerary, editable on the phone
- **Convert**: Thai baht and pounds, both ways, no ads
- **Info**: bookings, references and "show the driver" address cards
- **More**: to-do and packing lists, Thai phrases with audio

## How the data is kept private

This repository is public, but it holds no trip data in readable form. Everything personal lives in `trip.enc` on the `data` branch, encrypted on the phone with a family passphrase (AES-256-GCM, PBKDF2) before it is uploaded. Each phone needs the passphrase to read it and a GitHub token (contents: read and write, this repository only) to save changes.

## Updating data from a computer

```
git worktree add ../bsb-data data
BSB_PASS='the passphrase' node tools/data.mjs dump  ../bsb-data/trip.enc
BSB_PASS='the passphrase' node tools/data.mjs merge ../bsb-data/trip.enc records.json
```

Then commit and push the `data` branch. Bump `CACHE` in `sw.js` whenever app files change so phones pick up the new version.
