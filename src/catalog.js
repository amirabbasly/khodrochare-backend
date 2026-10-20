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
    const matches = models.flatMap(model => [model.normalizedName, ...model.aliases].map(alias => ({ model, alias })))
      .filter(({ alias }) => text.startsWith(alias) && !(/\d$/.test(alias) && /^\d/.test(text.slice(alias.length))))
      .sort((a, b) => b.alias.length - a.alias.length);
    return matches[0]?.model || null;
  }
  return { search, resolve };
}
module.exports = { createCatalog };
