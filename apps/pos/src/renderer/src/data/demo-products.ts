import imgMorningGlory from "../assets/products/morning-glory.jpg";
import imgEnoki from "../assets/products/enoki.jpg";
import imgRibs from "../assets/products/ribs.jpg";
import imgLoin from "../assets/products/loin.jpg";
import imgTofu from "../assets/products/tofu.jpg";
import imgPorkBounce from "../assets/products/pork-bounce.jpg";
import imgCabbage from "../assets/products/cabbage.jpg";
import imgMeatball from "../assets/products/meatball.jpg";
import imgBelly from "../assets/products/belly.jpg";
import imgMussels from "../assets/products/mussels.jpg";
import imgSauce from "../assets/products/sauce.jpg";
import imgMisc from "../assets/products/misc.jpg";

export type QuickProduct = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  price: number | null;
  tone: string;
  image: string;
  /** จากหลังบ้าน — เลือกเป็นสินค้าด่วนบนจอ POS */
  isQuick?: boolean;
  /** ลำดับบนจอสินค้าด่วน (น้อย = มาก่อน) */
  quickSort?: number;
  isOpenPrice?: boolean;
  openPriceMax?: number;
};

export const DEMO_PRODUCTS: QuickProduct[] = [
  {
    id: "1",
    barcode: "8850001000011",
    productCode: "00001",
    name: "ผักบุ้ง",
    unit: "มัด",
    price: 15,
    tone: "#2f9e44",
    image: imgMorningGlory,
    isQuick: true,
    quickSort: 1,
  },
  {
    id: "2",
    barcode: "8850001000028",
    productCode: "00002",
    name: "เห็ดเข็มทอง",
    unit: "แพ็ค",
    price: 25,
    tone: "#e67700",
    image: imgEnoki,
    isQuick: true,
    quickSort: 2,
  },
  {
    id: "3",
    barcode: "8850001000035",
    productCode: "00003",
    name: "ซี่โครง",
    unit: "กก.",
    price: null,
    tone: "#c92a2a",
    image: imgRibs,
    isQuick: false,
    quickSort: 3,
  },
  {
    id: "4",
    barcode: "8850001000042",
    productCode: "00004",
    name: "สันนอก",
    unit: "กก.",
    price: null,
    tone: "#a61e4d",
    image: imgLoin,
    isQuick: false,
    quickSort: 4,
  },
  {
    id: "5",
    barcode: "8850001000059",
    productCode: "00005",
    name: "เต้าหู้ไข่",
    unit: "แพ็ค",
    price: 20,
    tone: "#f59f00",
    image: imgTofu,
    isQuick: true,
    quickSort: 5,
  },
  {
    id: "6",
    barcode: "8850001000066",
    productCode: "00006",
    name: "หมูเด้ง",
    unit: "กก.",
    price: null,
    tone: "#e03131",
    image: imgPorkBounce,
    isQuick: false,
    quickSort: 6,
  },
  {
    id: "7",
    barcode: "8850001000073",
    productCode: "00007",
    name: "ผักกาดขาว",
    unit: "กก.",
    price: 35,
    tone: "#37b24d",
    image: imgCabbage,
    isQuick: true,
    quickSort: 7,
  },
  {
    id: "8",
    barcode: "8850001000080",
    productCode: "00008",
    name: "ลูกชิ้นหมู",
    unit: "แพ็ค",
    price: 45,
    tone: "#d6336c",
    image: imgMeatball,
    isQuick: true,
    quickSort: 8,
  },
  {
    id: "9",
    barcode: "8850001000097",
    productCode: "00009",
    name: "สามชั้นสไลด์",
    unit: "กก.",
    price: null,
    tone: "#c2255c",
    image: imgBelly,
    isQuick: false,
    quickSort: 9,
  },
  {
    id: "10",
    barcode: "8850001000103",
    productCode: "00010",
    name: "หอยดอง",
    unit: "ขวด",
    price: 25,
    tone: "#1098ad",
    image: imgMussels,
    isQuick: true,
    quickSort: 10,
  },
  {
    id: "11",
    barcode: "8850001000110",
    productCode: "00011",
    name: "น้ำจิ้มซีฟู้ด",
    unit: "ขวด",
    price: 35,
    tone: "#f08c00",
    image: imgSauce,
    isQuick: true,
    quickSort: 11,
  },
  {
    id: "12",
    barcode: "MISC",
    productCode: "99999",
    name: "สินค้าเบ็ดเตล็ด",
    unit: "ชิ้น",
    price: null,
    tone: "#495057",
    image: imgMisc,
    isQuick: false,
    quickSort: 999,
    isOpenPrice: true,
    openPriceMax: 100,
  },
];
