const mongoose = require('mongoose');

const bagSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  characterName: { type: String, default: 'My Character' },
  bags: {
    pack:          { type: [String], default: [] },
    potions:       { type: [String], default: [] },
    attunement:    { type: [String], default: [] },
    mps:           { type: [String], default: [] },
    weapons_armor: { type: [String], default: [] },
    trinkets:      { type: [String], default: [] },
    fish:          { type: [String], default: [] },
    uncrafted:     { type: [String], default: [] },
    mount:         { type: [String], default: [] },
    special:       { type: [String], default: [] },
    components:    { type: [String], default: [] },
    dump:          { type: [String], default: [] },
    crafted:       { type: [String], default: [] },
    consumables:   { type: [String], default: [] },
  }
});

module.exports = mongoose.model('Bag', bagSchema);