// Produce, units, transport modes, incoterms and shipping-document checklists.
const c = (name, category, perishable = 0, live = 0) => ({ name, category, perishable: !!perishable, live: !!live }); // live = living animals (sold per head; need vet/movement papers, a suitable vehicle, a different quality check)
const CROPS = [
  c("Tomatoes","Vegetables",1), c("Onions","Vegetables"), c("Potatoes","Vegetables"), c("Cabbage","Vegetables",1), c("Kale / collard greens","Vegetables",1),
  c("Spinach","Vegetables",1), c("Carrots","Vegetables"), c("Green beans","Vegetables",1), c("Peppers / chillies (fresh)","Vegetables",1), c("Cucumbers","Vegetables",1),
  c("Eggplant","Vegetables",1), c("Lettuce","Vegetables",1), c("Broccoli","Vegetables",1), c("Cauliflower","Vegetables",1), c("Garlic","Vegetables"), c("Ginger","Vegetables"),
  c("Pumpkin / squash","Vegetables"), c("Peas","Vegetables",1), c("Okra","Vegetables",1), c("Sweet corn","Vegetables",1), c("Asparagus","Vegetables",1), c("Mushrooms","Vegetables",1),
  c("Avocado","Fruits",1), c("Mango","Fruits",1), c("Bananas","Fruits",1), c("Pineapple","Fruits",1), c("Passion fruit","Fruits",1), c("Oranges","Fruits",1), c("Lemons / limes","Fruits",1),
  c("Apples","Fruits",1), c("Grapes","Fruits",1), c("Berries","Fruits",1), c("Watermelon","Fruits",1), c("Papaya","Fruits",1), c("Dates","Fruits"), c("Coconut","Fruits"),
  c("Pomegranate","Fruits",1), c("Figs","Fruits",1),
  c("Cassava","Roots & tubers"), c("Sweet potato","Roots & tubers"), c("Yam","Roots & tubers"),
  c("Maize","Grains"), c("Rice","Grains"), c("Wheat","Grains"), c("Sorghum","Grains"), c("Millet","Grains"), c("Barley","Grains"), c("Oats","Grains"),
  c("Beans","Pulses"), c("Lentils","Pulses"), c("Chickpeas","Pulses"), c("Cowpeas","Pulses"), c("Soybeans","Pulses"),
  c("Cashew nuts","Nuts & seeds"), c("Macadamia","Nuts & seeds"), c("Groundnuts / peanuts","Nuts & seeds"), c("Sesame","Nuts & seeds"), c("Sunflower seeds","Nuts & seeds"), c("Almonds","Nuts & seeds"), c("Pistachios","Nuts & seeds"),
  c("Coffee","Cash crops"), c("Tea","Cash crops"), c("Cocoa","Cash crops"), c("Cotton","Cash crops"), c("Sugar","Cash crops"), c("Vanilla","Cash crops"),
  c("Black pepper","Spices"), c("Turmeric","Spices"), c("Cloves","Spices"), c("Cardamom","Spices"), c("Cinnamon","Spices"), c("Chilli (dried)","Spices"),
  c("Cut flowers","Flowers",1), c("Honey","Other"),
];
const MORE = {
  "Fruits": [["Apricots",1],["Peaches",1],["Plums",1],["Pears",1],["Cherries",1],["Kiwi",1],["Guava",1],["Lychee",1],["Jackfruit",1],["Dragon fruit",1],["Tamarind",0],["Starfruit",1],["Soursop",1],["Tangerines / mandarins",1],["Grapefruit",1],["Melon",1],["Cantaloupe",1],["Strawberries",1],["Blueberries",1],["Raspberries",1],["Plantain",1],["Breadfruit",1],["Durian",1],["Mangosteen",1],["Rambutan",1],["Cranberries",1],["Olives",0],["Tree tomato (tamarillo)",1]],
  "Vegetables": [["Beetroot",0],["Radish",1],["Turnip",0],["Leeks",1],["Spring onions",1],["Celery",1],["Zucchini / courgette",1],["Bell peppers",1],["Scotch bonnet chillies",1],["Snow peas / mange tout",1],["Baby corn",1],["Artichoke",1],["Brussels sprouts",1],["Pak choi",1],["Amaranth leaves",1],["African nightshade (managu)",1],["Cowpea leaves (kunde)",1],["Spider plant (saget)",1],["Fennel",1],["Butternut squash",0],["Red onions",0],["Shallots",0]],
  "Herbs & leaves": [["Coriander / cilantro",1],["Parsley",1],["Mint",1],["Basil",1],["Dill",1],["Rosemary",1],["Thyme",1],["Lemongrass",1],["Moringa leaves",1],["Curry leaves",1]],
  "Roots & tubers": [["Arrowroot",0],["Taro / cocoyam",0],["Irish potato",0]],
  "Grains": [["Teff",0],["Quinoa",0],["Rye",0],["Fonio",0],["Buckwheat",0],["Wheat flour",0],["Maize flour",0]],
  "Pulses": [["Pigeon peas",0],["Green grams (mung beans)",0],["Black-eyed peas",0],["Fava beans",0],["Kidney beans",0],["Black beans",0]],
  "Nuts & seeds": [["Walnuts",0],["Hazelnuts",0],["Brazil nuts",0],["Pecans",0],["Flaxseed",0],["Chia seeds",0],["Pumpkin seeds",0],["Shea nuts",0],["Cashew apples",1]],
  "Cash crops": [["Palm oil",0],["Sisal",0],["Pyrethrum",0],["Natural rubber",0],["Jute",0],["Sugarcane",0],["Cocoa beans",0],["Green coffee",0]],
  "Spices": [["Saffron",0],["Nutmeg",0],["Paprika",0],["Cumin",0],["Coriander seeds",0],["Fenugreek",0],["Star anise",0],["Allspice",0],["Ginger (dried)",0],["Turmeric powder",0]],
  "Medicinal & other": [["Aloe vera",1],["Moringa powder",0],["Hibiscus (dried)",0],["Neem",0],["Stevia",0],["Bamboo",0],["Beeswax",0],["Cut roses",1],["Potted plants",1],["Mushrooms (dried)",0]],
  "Livestock": [["Cattle - dairy cows",0,1],["Cattle - beef (steers / bulls)",0,1],["Calves",0,1],["Goats",0,1],["Sheep",0,1],["Pigs",0,1],["Chicken - broilers",0,1],["Chicken - layers",0,1],["Chicken - indigenous (kienyeji)",0,1],["Turkeys",0,1],["Ducks",0,1],["Geese",0,1],["Guinea fowl",0,1],["Quail",0,1],["Rabbits",0,1],["Camels",0,1],["Donkeys",0,1]],
  "Animal products": [["Eggs",1],["Milk (fresh)",1],["Beef",1],["Goat meat",1],["Mutton",1],["Pork",1],["Chicken (dressed)",1],["Hides & skins",0],["Wool",0]],
  "Fish & aquaculture": [["Tilapia",1],["Nile perch",1],["Catfish",1],["Omena (silver cyprinid)",1],["Fish (other)",1]]
  ,"Oils, juices & dairy drinks": [["Fermented milk (mala)",1],["Yoghurt",1],["Cooking oil (sunflower)",0],["Coconut oil",0],["Avocado oil",0],["Groundnut oil",0],["Fruit juice",1],["Coconut water",1],["Honey",0]]
};
Object.entries(MORE).forEach(([cat, items]) => items.forEach(([n, p, lv]) => { if (!CROPS.some((x) => x.name.toLowerCase() === n.toLowerCase())) CROPS.push(c(n, cat, p, lv)); }));

// Liquids are sold by VOLUME (litre, jerrycan, drum, tank) — or by weight for things like honey; solids are never sold by the litre.
const LIQUID_RE = /^(milk\b|fermented milk|yoghurt|honey|fruit juice|coconut water)|\boil\b/i; for (const x of CROPS) x.liquid = LIQUID_RE.test(x.name) && !x.live;
const UNITS = [
  { v: "kg", l: "kilogram (kg)" }, { v: "tonne", l: "metric tonne" }, { v: "lb", l: "pound (lb)" }, { v: "bag50", l: "50 kg bag" }, { v: "bag90", l: "90 kg bag" },
  { v: "crate", l: "crate" }, { v: "box", l: "box / carton" }, { v: "pallet", l: "pallet" }, { v: "container20", l: "20 ft container load" }, { v: "container40", l: "40 ft container load" },
  { v: "bunch", l: "bunch / piece" }, { v: "litre", l: "litre (L)", kind: "volume" }, { v: "jerrycan20", l: "jerrycan (20 litres)", kind: "volume" }, { v: "drum200", l: "drum (200 litres)", kind: "volume" }, { v: "tank1000", l: "tank (1,000 litres)", kind: "volume" }, { v: "head", l: "per animal (head)" }, { v: "tray", l: "egg tray (30 eggs)" }, { v: "dozen", l: "dozen" },
];
const TEMPERATURES = [{ v: "ambient", l: "Ambient (no cooling)" }, { v: "chilled", l: "Chilled (cold chain)" }, { v: "frozen", l: "Frozen" }];
// reefer = can carry temperature-controlled cargo
const m = (id, label, category, scope, reefer = false) => ({ id, label, category, scope, reefer });
const MODES = [
  m("handcart","Handcart / head load","Light","local"), m("bicycle","Bicycle","Light","local"), m("motorbike","Motorbike (boda boda)","Road","local"),
  m("tuktuk","Tuk-tuk / three-wheeler","Road","local"), m("animal_cart","Animal-drawn cart","Light","local"), m("car","Car / small van","Road","local"),
  m("pickup","Pickup truck","Road","regional"), m("light_truck","Light truck","Road","regional"), m("heavy_truck","Heavy truck / trailer","Road","regional"),
  m("reefer_truck","Refrigerated truck","Road","regional",true), m("rail","Rail freight","Rail","regional"), m("barge","River / lake barge or boat","Water","regional"),
  m("coastal","Coastal vessel / dhow","Water","regional"), m("sea_container","Sea freight - dry container","Sea","intercontinental"),
  m("sea_reefer","Sea freight - refrigerated container","Sea","intercontinental",true), m("bulk_vessel","Bulk carrier","Sea","intercontinental"),
  m("air_general","Air freight - general cargo","Air","intercontinental"), m("air_cold","Air freight - temperature-controlled","Air","intercontinental",true),
  m("multimodal","Multimodal (combination)","Multimodal","intercontinental",true),
];
const BUSINESS_TYPES = [{ v: "farm", l: "Farm / farmer-owned business" }, { v: "cooperative", l: "Cooperative / farmer group" }, { v: "exporter", l: "Exporter / trader" }, { v: "processor", l: "Processor / manufacturer" }, { v: "wholesaler", l: "Wholesaler / distributor" }, { v: "retailer", l: "Retailer / market trader" }, { v: "restaurant_hotel", l: "Restaurant / hotel / caterer" }, { v: "supermarket", l: "Supermarket / grocery chain" }, { v: "other", l: "Other business" }];
const BUSINESS_TYPE_IDS = new Set(BUSINESS_TYPES.map((x) => x.v));
const MODE_IDS = new Set(MODES.map((x) => x.id));
const MODE_BY_ID = Object.fromEntries(MODES.map((x) => [x.id, x]));
const INCOTERMS = [
  { v: "EXW", l: "EXW - Ex Works (buyer arranges everything from seller's premises)" },
  { v: "FCA", l: "FCA - Free Carrier (seller hands over to buyer's carrier, export-cleared)" },
  { v: "CPT", l: "CPT - Carriage Paid To (seller pays main carriage)" },
  { v: "CIP", l: "CIP - Carriage and Insurance Paid To" },
  { v: "DAP", l: "DAP - Delivered at Place (seller delivers to destination; buyer clears import)" },
  { v: "DPU", l: "DPU - Delivered at Place Unloaded" },
  { v: "DDP", l: "DDP - Delivered Duty Paid (seller bears all costs incl. import duty)" },
  { v: "FAS", l: "FAS - Free Alongside Ship (sea only)" }, { v: "FOB", l: "FOB - Free on Board (sea only)" },
  { v: "CFR", l: "CFR - Cost and Freight (sea only)" }, { v: "CIF", l: "CIF - Cost, Insurance and Freight (sea only)" },
];
const INCOTERM_IDS = new Set(INCOTERMS.map((x) => x.v));
const CARGO_STATUSES = ["picked_up", "in_transit", "at_customs", "delivered"];

function cropInfo(name) { return CROPS.find((x) => x.name.toLowerCase() === String(name).toLowerCase()) || null; }

// Typical paperwork. Real requirements vary by product, route and country — always verify with both countries' authorities.
function docChecklist({ international, perishable, live }) {
  const MOVE = { id: "movement_permit", label: "Livestock movement permit (county veterinary office)" }, VET = { id: "vet_certificate", label: "Veterinary health certificate (official veterinary service)" };
  if (!international) return [{ id: "delivery_note", label: "Delivery note / goods received note" }, ...(live ? [MOVE] : [])];
  const docs = [
    { id: "commercial_invoice", label: "Commercial invoice" }, { id: "packing_list", label: "Packing list" },
    { id: "certificate_of_origin", label: "Certificate of origin (if required)" },
    { id: "export_declaration", label: "Export declaration / customs clearance (origin country)" },
    { id: "import_clearance", label: "Import declaration / duties and permits (destination country)" },
    { id: "transport_document", label: "Transport document (bill of lading / airway bill / road or rail consignment note)" },
    { id: "insurance_certificate", label: "Cargo insurance certificate" },
  ];
  docs.splice(3, 0, live ? VET : { id: "phytosanitary", label: "Phytosanitary certificate (plant products - usually required)" }); if (live) docs.splice(4, 0, MOVE);
  if (perishable) docs.push({ id: "temperature_log", label: "Temperature log / cold-chain record" });
  return docs;
}
module.exports = { BUSINESS_TYPES, BUSINESS_TYPE_IDS, CROPS, UNITS, TEMPERATURES, MODES, MODE_IDS, MODE_BY_ID, INCOTERMS, INCOTERM_IDS, CARGO_STATUSES, cropInfo, docChecklist };
