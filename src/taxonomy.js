// Classifies plugins into type → category → subcategory from their name and metadata hints.
const TYPES = ['Effect', 'Instrument', 'MIDI FX'];

// [category, subcategory, regex] – first match wins, so specific rules come first.
// Well-known plugins whose names don't say what they do.
const KNOWN_RULES = [
  ['Channel Strip', 'Preamp', /preamp|mic collection|hemisphere|sphere mic|putnam mic|ocean way|610-?[ab]|uaudio_610|v76|neve 31102|trident|harrison|api preamp|vt-?737|voxbox|ultrachannel|uaudio_api|c-suite c-vox|uaudio_anthem|uaudio_showtime|uaudio_opal|raw\(|wood works|um22[56]|w43|vertigo vsm/i],
  ['Drive', 'Amp', /diezel|engl|friedman|suhr|fuchs|eden wt|gallien|krueger|c-axe|bermuda|amp\b|amps\b/i],
  ['Dynamics', 'Compressor', /2254|175-?b|\b176\b|tla-?100|vsc-?2|mpressor|fatso|elysia|alpha mix|karacter|c-max|ua 17|culture vulture/i],
  ['Dynamics', 'Gate', /x-?(click|crackle|hum|noise)|z-?noise|wns\b|duck\b|x-?fdbk/i],
  ['Dynamics', 'De-esser', /suprEsser|xvox ds/i],
  ['Drive', 'Saturation', /inflator|biscuit|vitamin|precision enhancer|torque|vintage|tract\b|zebrify|xvox tone/i],
  ['Delay', 'Multi-tap', /time cube|ultratap|transit|xvox space/i],
  ['Reverb', 'Algorithmic', /bx 20|akg bx|reflection engine|zrev|blackhole|texture|undulator/i],
  ['Pitch', 'Harmonizer', /vocal bender|xvox|sync vx|octavox|vogue/i],
  ['EQ', 'Vintage', /envolution|little labs|bx_refinement|vog\b|ibp\b/i],
  ['Utility', 'Tuner', /bx_tuner/i],
  ['Utility', 'Tool', /wavelab|stream receive|studiorack|wlm|center\b|impusher|king'?s microphones|emo-generator/i],
  ['Channel Strip', 'Console', /cla (vocals|guitars|bass|drums|unplugged|epic|effects|mixdown|nx)|jjp-|scheps 73|ssl ?ev2|sslchannel|rchannel|nls (buss|channel)|ev2 channel|echannel|gw (mix|voice|tone|piano)centric|maserati|studioverse|bx_digital|butch vig|mannym|eddie kramer|neutron|nectar|channel ?strip|api-?2500|ssleq|mixbox|abbey road (emi|redd|rs124|tg)|v-?eq|puigchild|bx_rockrack|clarity vx|q-?clone|dorrough|tonal ?balance/i],
  ['Dynamics', 'Compressor', /omnipressor|parallel aggressor|oneknob pumper|rvox|mv2|smooth operator|api-?2500|puigchild|dpr-?402|comeback kid/i],
  ['Dynamics', 'Limiter', /l316|oneknob louder|silk vocal|elevate|invigorate/i],
  ['Dynamics', 'Transient', /punctuate|emo-d5|trans-?x/i],
  ['Dynamics', 'Gate', /voicegate|gatekeeper|ns1\b|denoise|de-?noise|de-?click|de-?hum|de-?breath|de-?clip|debreath|deboom|dxrevive|rx ?\d/i],
  ['EQ', 'Parametric', /curves equator|equivocate|req ?\d|api-?5[56]0|ssleq|scheps 73|splitEQ|linEQ|saphira|eq/i],
  ['EQ', 'Vintage', /puigtec|oneknob brighter|pse\b|retro ?fi|super vhs/i],
  ['Drive', 'Saturation', /oneknob phatter|faturator|emo-f2|crystalline|ihny|dune3 ?fx|parallel particles|spl free ranger|humanoid|submarine|maxxbass|rbass|lo ?air|bx_subsynth|boost\b/i],
  ['Drive', 'Amp', /gtr ?stomp|prs (dallas|v9)|bx_rockrack|mdmx|guitar/i],
  ['Delay', 'Multi-tap', /supertap|h-?delay|recirculate|crystals/i],
  ['Reverb', 'Convolution', /irlive|ir-?\d|raum|abbey road (studio|chambers|plates)|nx ocean|nx germano|kings? microphones/i],
  ['Reverb', 'Algorithmic', /oneknob wetter|spaced out|space ?blender|sheen|h3000|replika/i],
  ['Pitch', 'Harmonizer', /octavox|quadravox|ovox|lexresonantchords|key detector|physion/i],
  ['Modulation', 'Modulation', /mondomod|multimod|enigma|doppler|manipulator|filtron|morphoder|cyclop|egoist|disperser|snap heap|multipass|kHs |articulate|i wish|supermodal/i],
  ['Spatial', 'Surround', /\bnx\b|immersive|ps22|s1 shuffler|center \(|paz-|asaf|binaural|wrapper/i],
  ['Utility', 'Tool', /audiotrack|q-?capture|relay|reaktor .*fx|reason rack|maschine 2 fx|serum 2 fx|bx_solo|bx_cleansweep|lexstringbox|epic notes|efx refract|key detector/i],
];

const EFFECT_RULES = [
  ...KNOWN_RULES,
  ['Utility', 'Meter', /meter|analy[sz]|scope|spectrum|loudness|insight|\blufs\b|correlat|span\b|metric ab|vu\b|dpmeter/i],
  ['Utility', 'Tuner', /\btuner\b|tuning ?fork/i],
  ['Pitch', 'Vocoder', /vocod/i],
  ['Pitch', 'Tuning', /auto-?tune|melodyne|waves tune|\btune real|pitch ?correct|graillon|little ?alter/i],
  ['Pitch', 'Harmonizer', /harmon(?!ic)|doubler|octav|micropitch|h910|h949|eventide h/i],
  ['Pitch', 'Pitch Shift', /pitch|shifter|transpos|soundshifter/i],
  ['Channel Strip', 'Console', /console|ssl ?(4000|9000|e |g )|neve ?(88|vxs)|api vision|mix ?hub|the.?strip|channel ?strip|strip\b|scheps omni|v-?series|ec-300/i],
  ['Dynamics', 'De-esser', /de-?ess|sibil|pro-ds|deesser/i],
  ['Dynamics', 'Multiband', /multi-?band|pro-mb|c4\b|c6\b|linmb|ozone.*dynam|xpand|multi-?comp/i],
  ['Dynamics', 'Transient', /transient|punch|smack|trans-?x|envelope shaper|impact|spiff|attack/i],
  ['Dynamics', 'Gate', /\bgate\b|gater|pro-g\b|noise ?gate|trigger ?gate/i],
  ['Dynamics', 'Expander', /expander|upward/i],
  ['Dynamics', 'Rider', /rider|leveler|vocal ?rider|bass ?rider|autolevel|align/i],
  ['Dynamics', 'Limiter', /limit|maxim|l1\b|l2\b|l3\b|pro-l|clipper|\bclip\b|ozone|elevate|loudmax|maximizer|master/i],
  ['Dynamics', 'Compressor', /comp|1176|la-?2a|la-?3a|fairchild|opto|dbx|ssl ?g|cla-?76|cla-?2a|cla-?3a|distressor|bus ?comp|glue|vca|fet|squeez|pressure|kotelnikov|dyn|renaissance|rcomp|h-?comp|c1\b|smash|teletronix|160|33609|tube-?tech|cl ?1b|vari-?mu|mu\b/i],
  ['EQ', 'Dynamic EQ', /dynamic ?eq|f6\b|soothe|pro-q ?[34]|resonan(ce|t) supp|trackspacer|gullfoss/i],
  ['EQ', 'Vintage', /pultec|eqp-?1a|meq|puigtec|neve ?10|1073|1084|api ?5[56]0|helios|maag|massive passive|lang|baxandall|tilt|chandler|curve ?bender/i],
  ['EQ', 'Graphic', /graphic|geq\b/i],
  ['EQ', 'Parametric', /\beq\b|equali|pro-q|eq\d|q\d+\b|channel ?eq|eq ?eight|eq ?three|filterbank|sculpt/i],
  ['Reverb', 'Shimmer', /shimmer|blackhole|cloud|ethereal|valhalla ?super/i],
  ['Reverb', 'Plate', /plate|emt/i],
  ['Reverb', 'Spring', /spring/i],
  ['Reverb', 'Convolution', /convol|impulse|\bir\b|altiverb|space ?designer|ir-?\d/i],
  ['Reverb', 'Room', /room|chamber|ambien/i],
  ['Reverb', 'Hall', /hall|cathedral|church/i],
  ['Reverb', 'Algorithmic', /reverb|verb|lexicon|pro-r|rverb|abbey road reverb|h-?reverb|valhalla|seventh heaven|bricasti|r2 /i],
  ['Delay', 'Tape Echo', /tape ?echo|space ?echo|re-?201|echoplex|echo ?boy|galaxy|roland ?re|binson|el ?capistan/i],
  ['Delay', 'Multi-tap', /multi-?tap|step ?delay|stepdelay|filter ?delay|ping|pong|tap ?delay|h-?delay|timeless/i],
  ['Delay', 'Echo', /delay|echo|dly/i],
  ['Drive', 'Amp', /\bamp\b|amps|amplifier|cab|guitar ?rig|amplitube|bias|neural|helix|th-?u|ampeg|marshall|mesa|fender|bass ?amp|svt|kemper|archetype/i],
  ['Drive', 'Bitcrusher', /bit ?crush|decimat|redux|lo-?fi|lofi|degrad|crush|sampler ?emul|sp-?950|sp-?1200|rc-?20|vinyl/i],
  ['Drive', 'Tape', /tape|j37|ampex|studer|kramer ?master|reel|ferric|atr|mpc ?tape/i],
  ['Drive', 'Tube', /tube|valve|triode|vari-?tube/i],
  ['Drive', 'Distortion', /distort|fuzz|overdrive|drive|devil-?loc|berzerk|trash|decapitator|roar|erosion|pedal|filthy|krush/i],
  ['Drive', 'Saturation', /satur|saturn|exciter|aphex|harmonic|warm|color|colour|analog ?channel|hg-?2|black ?box|kramer|tape|console/i],
  ['Modulation', 'Chorus', /chorus|dimension|juno|ensemble|tri-?chorus|doubl/i],
  ['Modulation', 'Flanger', /flang/i],
  ['Modulation', 'Phaser', /phas/i],
  ['Modulation', 'Tremolo', /tremol|auto ?pan|panman|pan-?trem/i],
  ['Modulation', 'Rotary', /rotary|leslie|rotor/i],
  ['Modulation', 'Vibrato', /vibrato|wow|flutter/i],
  ['Modulation', 'Ring Mod', /ring ?mod|frequency ?shift|freq ?shift/i],
  ['Modulation', 'Modulation', /modul|mod ?fx|lfo|motion/i],
  ['Filter', 'Formant', /formant|vowel|talk ?box/i],
  ['Filter', 'Envelope Filter', /envelope ?filter|auto ?filter|auto-?wah|wah|filter ?freak|mutron|envelope ?follow/i],
  ['Filter', 'Filter', /filter|volcano|\blp\b|\bhp\b|one ?knob ?filter|resonator/i],
  ['Spatial', 'Surround', /surround|5\.1|7\.1|atmos|ambison|panner ?3d|\bdearvr|binaural|3d ?audio|spat\b|360/i],
  ['Spatial', 'Stereo Imager', /stereo|imager|width|wider|s1 ?imager|ms ?|mid-?side|haas|mono|spread|microshift|dimension expander/i],
  ['Spatial', 'Panner', /pan\b|panner/i],
  ['Multi FX', 'Multi FX', /multi ?fx|effect ?rack|fx ?chain|effectrix|stutter|glitch|beat ?repeat|grain|granul|looper|halftime|gross ?beat|shaperbox|freeze|spectral|creative|portal|crystallizer|weird|playground/i],
  ['Utility', 'Routing', /rout|send|return|aux|sidechain|bridge|vst ?shell|shell|external|link|connect|remote|rewire/i],
  ['Utility', 'Gain', /\bgain|trim|utility|volume|level|phase ?invert|polarity|silence|null/i],
  ['Utility', 'Tool', /tool|manager|notepad|scope|test|calibr|reference|metric|monitor|headphone|sonarworks|soundid|room ?eq|arc ?|reveal/i],
];

const INSTRUMENT_RULES = [
  ['Drums', 'Drum Machine', /808|909|707|606|drum ?machine|drumazon|tr-?\d|linn|drumbrute|nerve|xo\b|atlas|microtonic|drumsynth|drum ?synth|impulse|beat ?box/i],
  ['Drums', 'Drums', /drum|kit|percuss|battery|addictive drums|superior|ezdrummer|ssd|groove agent|bfd|perc/i],
  ['Bass', 'Bass', /bass|tb-?303|abl|303|sub ?boom|trilian|moog ?taurus|ana-?bass/i],
  ['Keys', 'Piano', /piano|grand|upright|keyscape|pianoteq|noire|una corda|steinway|bösendorfer|ivory|electric/i],
  ['Keys', 'Organ', /organ|b-?3|hammond|vox ?continental|farfisa|combo/i],
  ['Keys', 'E-Piano', /rhodes|wurli|e-?piano|ep\b|mark ?i|clav|stage ?73|lounge ?lizard|electric/i],
  ['Orchestral', 'Strings', /string|violin|cello|orchestr|symphon|spitfire|albion|bbc|ensemble|brass|wind|horn|choir|vocal/i],
  ['Guitar', 'Guitar', /guitar|strum|ample|shreddage|electri6ity/i],
  ['Sampler', 'Sampler', /sampl|kontakt|rompler|simpler|halion|tal-?sampler|sforzando|decent|spitfire|labs|ugritone|omnisphere|keyzone|ableton sampler/i],
  ['Synth', 'Wavetable', /wavetable|serum|vital|pigments|massive|ana ?2|ana2|hive|phase ?plant|avenger|icarus|spire|sylenth|nexus|thorn|blackhole|atoms|zebra|vps/i],
  ['Synth', 'Analog', /analog|moog|mini|prophet|jup|juno|obx|ob-?x|ms-?20|cs-?80|arp|odyssey|pro-?one|jun-?6|diva|repro|monark|polysix|mono\/poly|sem|matrix|model ?d|drift|poly ?800|sh-?101|tal-?u|u-?he|oberheim|korg|roland|virus|osirus|ostirus|blofeld|ti\b/i],
  ['Synth', 'FM', /\bfm\b|dx-?7|operator|fm8|dexed|opsix|tx-?81/i],
  ['Synth', 'Modular', /modular|voltage|vcv|reaktor|bitwig grid|softube modular|cherry ?audio/i],
  ['Synth', 'Physical Modeling', /collision|tension|electric|corpus|physical|modell?ing|chromaphone|string ?studio/i],
  ['Synth', 'Synth', /synth|meld|\bone\b|twin|wavestation|m1\b|polymax|matriarch|surge|helm/i],
];

const MIDI_RULES = [
  ['Arpeggiator', 'Arpeggiator', /arp/i],
  ['Chord', 'Chord', /chord|scaler|harmon/i],
  ['Sequencer', 'Sequencer', /seq|step|pattern|euclid|rhythm|groove/i],
  ['Generator', 'Generator', /random|generat|melody|riff/i],
  ['Note Tools', 'Note Tools', /note|velocity|pitch|scale|length|echo/i],
  ['Controller', 'Controller', /control|mpe|cc|lfo|envelope|map|remote/i],
];

// Ableton's built-in devices, classified by hand.
const STOCK = {
  'Amp': ['Drive', 'Amp'], 'Cabinet': ['Drive', 'Amp'], 'Pedal': ['Drive', 'Distortion'], 'Overdrive': ['Drive', 'Distortion'],
  'Saturator': ['Drive', 'Saturation'], 'Dynamic Tube': ['Drive', 'Tube'], 'Roar': ['Drive', 'Distortion'], 'Erosion': ['Drive', 'Bitcrusher'],
  'Redux': ['Drive', 'Bitcrusher'], 'Vinyl Distortion': ['Drive', 'Bitcrusher'], 'Drum Buss': ['Drive', 'Saturation'],
  'Auto Filter': ['Filter', 'Envelope Filter'], 'Envelope Follower': ['Modulation', 'Modulation'], 'Shaper': ['Modulation', 'Modulation'],
  'Auto Pan-Tremolo': ['Modulation', 'Tremolo'], 'Auto Pan': ['Modulation', 'Tremolo'], 'Chorus-Ensemble': ['Modulation', 'Chorus'],
  'Phaser-Flanger': ['Modulation', 'Phaser'], 'LFO': ['Modulation', 'Modulation'], 'Auto Shift': ['Pitch', 'Tuning'], 'Shifter': ['Pitch', 'Pitch Shift'],
  'Vocoder': ['Pitch', 'Vocoder'], 'Beat Repeat': ['Multi FX', 'Multi FX'], 'Looper': ['Multi FX', 'Multi FX'], 'Grain Delay': ['Delay', 'Multi-tap'],
  'Delay': ['Delay', 'Echo'], 'Echo': ['Delay', 'Tape Echo'], 'Filter Delay': ['Delay', 'Multi-tap'], 'Spectral Time': ['Multi FX', 'Multi FX'],
  'Spectral Resonator': ['Filter', 'Filter'], 'Resonators': ['Filter', 'Filter'], 'Corpus': ['Filter', 'Filter'],
  'Compressor': ['Dynamics', 'Compressor'], 'Glue Compressor': ['Dynamics', 'Compressor'], 'Limiter': ['Dynamics', 'Limiter'],
  'Gate': ['Dynamics', 'Gate'], 'Multiband Dynamics': ['Dynamics', 'Multiband'], 'Channel EQ': ['EQ', 'Parametric'],
  'EQ Eight': ['EQ', 'Parametric'], 'EQ Three': ['EQ', 'Parametric'], 'Reverb': ['Reverb', 'Algorithmic'], 'Hybrid Reverb': ['Reverb', 'Convolution'],
  'Spectrum': ['Utility', 'Meter'], 'Tuner': ['Utility', 'Tuner'], 'Utility': ['Utility', 'Gain'], 'External Audio Effect': ['Utility', 'Routing'],
  'Analog': ['Synth', 'Analog'], 'Drift': ['Synth', 'Analog'], 'Operator': ['Synth', 'FM'], 'Wavetable': ['Synth', 'Wavetable'], 'Meld': ['Synth', 'Synth'],
  'Collision': ['Synth', 'Physical Modeling'], 'Tension': ['Synth', 'Physical Modeling'], 'Electric': ['Keys', 'E-Piano'],
  'Impulse': ['Drums', 'Drums'], 'Sampler': ['Sampler', 'Sampler'], 'Simpler': ['Sampler', 'Sampler'], 'External Instrument': ['Utility', 'Routing'],
};

function classifyWith(rules, text) {
  for (const [category, sub, re] of rules) if (re.test(text)) return { category, sub };
  return null;
}

// hints: AU type (aumu/aumi/aufx/aumf), VST3 subcategories ("Fx|Dynamics", "Instrument|Synth") or Live folder names.
function classify(name, hints = '') {
  let type = 'Effect';
  if (/\baumi\b|midi ?effect|midi ?fx|\bmidi\b(?!.*fx)|\|generator/i.test(hints)) type = 'MIDI FX';
  else if (/\baumu\b|instrument|synth|sampler|drum/i.test(hints)) type = 'Instrument';

  name = name.replace(/\s*\((m|s|m->s|\d+->\d+)\)\s*$/i, '');
  const text = `${name} ${hints.replace(/\b(fx|instrument|aufx|aumf|aumu|aumi)\b/gi, '')}`;
  if (type === 'MIDI FX') return { type, ...(classifyWith(MIDI_RULES, name) || { category: 'Unsorted', sub: 'Unsorted' }) };
  if (type === 'Instrument') return { type, ...(classifyWith(INSTRUMENT_RULES, text) || { category: 'Synth', sub: 'Synth' }) };
  const fx = classifyWith(EFFECT_RULES, text);
  if (fx) return { type, ...fx };
  // Unknown "effects" whose name looks like an instrument usually are one (VST2 has no metadata).
  const inst = !hints && classifyWith(INSTRUMENT_RULES.filter(([c]) => c === 'Synth' || c === 'Drums'), name);
  if (inst && inst.sub !== 'Synth') return { type: 'Instrument', ...inst };
  return { type, category: 'Unsorted', sub: 'Unsorted' };
}

function classifyStock(name, folder) {
  const type = folder === 'Instruments' ? 'Instrument' : folder === 'MIDI Effects' ? 'MIDI FX' : 'Effect';
  const fixed = STOCK[name];
  if (fixed) return { type, category: fixed[0], sub: fixed[1] };
  if (type === 'MIDI FX') return { type, ...(classifyWith(MIDI_RULES, name) || { category: 'Unsorted', sub: 'Unsorted' }) };
  return classify(name, type === 'Instrument' ? 'instrument' : '');
}

module.exports = { classify, classifyStock, TYPES };
