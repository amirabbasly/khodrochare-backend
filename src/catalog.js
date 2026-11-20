const { HttpError } = require('./domain');
const { normalize } = require('./pricing');
function createCatalog(prisma) {
  async function search(query) {
    const q = normalize(query);
    return prisma.vehicleModel.findMany({ where: q ? { searchText: { contains: q } } : {}, include: { group: true }, orderBy: { name: 'asc' }, take: 20 });
  }
  async function resolve(name, id) {
    if (id) {
      const found = await prisma.vehicleModel.findUnique({ where: { id }, include: { group: true } });
      if (!found) throw new HttpError(400, 'Vehicle model not found');
      return found;
    }
    const text = normalize(name);
    const models = await prisma.vehicleModel.findMany({ include: { group: true } });
    let match = null, longest = -1;
    // Keep the longest prefix and the original first-match tie order without
    // allocating one object per alias or sorting all matching candidates.
    for (const model of models) {
      for (let i = -1; i < model.aliases.length; i++) {
        const alias = i < 0 ? model.normalizedName : model.aliases[i];
        if (alias.length <= longest || !text.startsWith(alias)) continue;
        if (/\d$/.test(alias) && /^\d/.test(text.slice(alias.length))) continue;
        match = model;
        longest = alias.length;
      }
    }
    return match;
  }
  return { search, resolve };
}
module.exports = { createCatalog };
