import XLSX from "xlsx";

const headers = ["Machine Name", "Spare Part Name", "Spare Image", "Price", "UOM"];

export const createSparePartsWorkbook = (products) => {
  const rows = products.map((product) => [
    product.category?.name || "",
    product.name,
    product.images?.length
      ? product.images.join(" | ")
      : product.image || "",
    product.price,
    product.uom || "",
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Spare Parts"
  );
  return workbook;
};
