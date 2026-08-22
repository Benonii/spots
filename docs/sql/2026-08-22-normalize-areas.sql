-- Normalize `spots.neighborhood` spellings.
--
-- The area filter no longer depends on this (apps/web/src/lib/areas.ts folds
-- variants onto a canonical label), so this is purely so the badge on the card,
-- Places we've been, and the editor stop showing three spellings of one place.
--
-- Every `old` below is a string that exists in the table today. Landmark detail
-- in parentheses is preserved — only the area name itself is corrected.
--
--   Block A — spelling and casing. Uncontroversial.
--   Block B — Ethiopic strings transliterated, and two unreadable strings
--             rewritten. Skip this block if you'd rather keep the originals.
--
-- Run inside the transaction; the final SELECT prints the resulting area list
-- so you can eyeball it before COMMIT.

BEGIN;

-- ---------------------------------------------------------------- Block A
UPDATE spots SET neighborhood = CASE neighborhood
  -- 4 Kilo / 5 Kilo
  WHEN '4 kilo'                        THEN '4 Kilo'
  WHEN '4kilo'                         THEN '4 Kilo'
  WHEN 'Arat Kilo'                     THEN '4 Kilo'
  WHEN 'Aratkilo'                      THEN '4 Kilo'
  WHEN 'Arada (Arat Kilo)'             THEN '4 Kilo (Arada)'
  WHEN '5kilo'                         THEN '5 Kilo'
  -- Summit (Semit / Sumit are the same area)
  WHEN 'summit'                        THEN 'Summit'
  WHEN 'Semit'                         THEN 'Summit'
  WHEN 'Semit (near Cambridge)'        THEN 'Summit (near Cambridge)'
  WHEN 'Semit Athlet Sefer (Cambridge)' THEN 'Summit Athlet Sefer (Cambridge)'
  WHEN 'Semit Safari'                  THEN 'Summit Safari'
  WHEN 'Semit Safari (in front of Agora)' THEN 'Summit Safari (in front of Agora)'
  WHEN 'Semit Fiyel Bet'               THEN 'Summit Fiyel Bet'
  WHEN 'Summit Fiyel bet'              THEN 'Summit Fiyel Bet'
  WHEN 'Summit (Fiyel Bet)'            THEN 'Summit Fiyel Bet'
  WHEN 'Semit (Feyelbet, beside Agora)' THEN 'Summit Fiyel Bet (beside Agora)'
  WHEN 'Semit (Semit fiyel bet, in front of L Classic)' THEN 'Summit Fiyel Bet (in front of L Classic)'
  WHEN 'Sumit File Bet (behind Ontime restaurant)' THEN 'Summit Fiyel Bet (behind Ontime restaurant)'
  WHEN 'Sumit fiyel bet (behind Aba Geda)' THEN 'Summit Fiyel Bet (behind Aba Geda)'
  -- Bole family
  WHEN 'Bole Micheal'                  THEN 'Bole Michael'
  WHEN 'Bole imperial'                 THEN 'Bole Imperial'
  WHEN 'Bole ednamall'                 THEN 'Bole (Edna Mall)'
  WHEN 'Edna Mall'                     THEN 'Bole (Edna Mall)'
  WHEN 'Bole (Medhanealem)'            THEN 'Bole (Medhanialem)'
  WHEN 'Bole (behind Medhane Alem)'    THEN 'Bole (behind Medhanialem)'
  WHEN 'Bole (behind Shegr building, Jamaica)' THEN 'Bole (behind Sheger building, Jamaica)'
  WHEN 'Bole (Rewanda)'                THEN 'Bole Rwanda'
  WHEN 'Bole Riwonda'                  THEN 'Bole Rwanda'
  WHEN 'Bole bulbula'                  THEN 'Bole Bulbula'
  WHEN 'Bole bulbula maryam mazorya'   THEN 'Bole Bulbula (Mariyam Mazoria)'
  WHEN 'Bole Bulbula, Mariyam Mazoriya' THEN 'Bole Bulbula (Mariyam Mazoria)'
  WHEN 'Bulbula Maryam mazorya, Tsehay building' THEN 'Bole Bulbula (Mariyam Mazoria, Tsehay building)'
  -- Wello Sefer
  WHEN 'Welo sefer'                    THEN 'Wello Sefer'
  WHEN 'Welo Sefer'                    THEN 'Wello Sefer'
  WHEN 'Bole Welo Sefer'               THEN 'Wello Sefer'
  WHEN 'Bole Wollo Sefer'              THEN 'Wello Sefer'
  WHEN 'Bole Wello'                    THEN 'Wello Sefer'
  -- the rest
  WHEN 'Piazza'                        THEN 'Piassa'
  WHEN 'Mergenagna'                    THEN 'Megenagna'
  WHEN 'Merakto'                       THEN 'Merkato'
  WHEN 'Ledeta'                        THEN 'Lideta'
  WHEN 'LIdeta'                        THEN 'Lideta'
  WHEN 'bitanya'                       THEN 'Bitanya'
  WHEN 'Bisrat gebriel'                THEN 'Bisrate Gebriel'
  WHEN 'Bisrate gebriel'               THEN 'Bisrate Gebriel'
  WHEN 'Bisrat Gebriel (Lafto)'        THEN 'Bisrate Gebriel (Lafto)'
  WHEN 'Adisu gebeya'                  THEN 'Adisu Gebeya'
  WHEN 'Adisu gebiya (in front of Sheger Park)' THEN 'Adisu Gebeya (in front of Sheger Park)'
  WHEN 'Lebu Musica'                   THEN 'Lebu Muzika Sefer'
  WHEN 'Lebu Musika sefer'             THEN 'Lebu Muzika Sefer'
  WHEN 'Lebu muzika sefer'             THEN 'Lebu Muzika Sefer'
  WHEN 'Gofa Mebrat Haile'             THEN 'Gofa Mebrat Hail'
  WHEN 'Gofa Mebrat Hayil'             THEN 'Gofa Mebrat Hail'
  WHEN 'Debrezeit'                     THEN 'Bishoftu (Debre Zeit)'
  WHEN 'Arbaminch'                     THEN 'Arba Minch'
  WHEN 'Arbaminch / Dorze village'     THEN 'Arba Minch (Dorze village)'
  ELSE neighborhood
END
WHERE neighborhood IS NOT NULL;

-- ---------------------------------------------------------------- Block B
UPDATE spots SET neighborhood = CASE neighborhood
  WHEN 'ጀሞ ሚካኤል'                       THEN 'Jemo (Michael)'
  WHEN 'ሰሚት ሰላሳ ሜትር'                    THEN 'Summit (30 meter)'
  WHEN 'ፍየል ቤት ከዊነር አጠገብ'                THEN 'Summit Fiyel Bet (next to Winner)'
  WHEN 'መካኒሳ አቦ ማዞሪያ አቦ ጋርደን'            THEN 'Mekanisa (Abo Mazoria, Abo Garden)'
  WHEN 'ፈረንሳይ ማዞርያ'                     THEN 'Ferensay Mazoria'
  WHEN 'ጋዜቦ አደበባይ'                      THEN 'Bole (Gazebo Square)'
  WHEN '22ከአዲሱ ስታዲየም ወደ አዲስ ሂወት ሆስፒታል መንገድ'
                                       THEN '22 (from the new stadium to Addis Hiwot hospital)'
  WHEN 'Hayat (ሀያት አደባባይ)'              THEN 'Hayat Square'
  -- two strings no reader can use
  WHEN 'Betel wed alm bank meheja awash bank fit le fit'
                                       THEN 'Betel (toward Alem Bank, opposite Awash Bank)'
  WHEN '22 (from Adey Ababa stadium to Addis Hiwot hospital)'
                                       THEN '22 (from Adey Abeba stadium to Addis Hiwot hospital)'
  ELSE neighborhood
END
WHERE neighborhood IS NOT NULL;

SELECT neighborhood, count(*) AS n
FROM spots WHERE neighborhood IS NOT NULL
GROUP BY neighborhood ORDER BY neighborhood;

-- COMMIT;   -- ← uncomment once the list above looks right, or ROLLBACK;
