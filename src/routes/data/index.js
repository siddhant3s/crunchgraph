import express from 'express';
import neo4j from 'neo4j';

const router = express.Router();

const db = new neo4j.GraphDatabase({
  url: 'http://10.1.10.157:7474',
  auth: { username: 'neo4j', password: 'pear' },
});

const sampleQuery = 'MATCH (o:Organization {company_name:{company_name}})' +
  '-[r:ACQUIRED]->(a) return r,a';

const pairwise = (list) => {
  if (list.length < 2) { return []; }
  const first = list[0];
  const rest = list.slice(1);
  const pairs = rest.map(x => [first, x]);
  return pairs.concat(pairwise(rest));
};

const doQuery = (query: string, cb): void => {
  db.http({
    method: 'POST',
    path: '/db/data/transaction/commit',
    raw: true,
    body: {
      statements: [
        { statement: query, parameters: {}, resultDataContents: ['row', 'graph'] },
      ],
    },
  }, (err, resp) => {
    if (err) throw err;
    console.log(resp.statusCode, 200);
    const graphs = resp.body.results[0].data.map(d => d.graph);
    const nodes = {};
    const rels = {};
    graphs.forEach(g => {
      g.nodes.forEach(n => { nodes[n.id] = n; });
      g.relationships.forEach(r => { rels[r.id] = r; });
    });
    const graph = { nodes: Object.values(nodes), relationships: Object.values(rels) };
    cb(graph, graph);
  });
};

router.get('/nodes', (req, res): void => {
  const { ids = [] } = req.query;
  if (!ids.length || !ids.map) {
    res.json({});
    return;
  }
  const queries = ids.map(id => ({
    query: 'MATCH (n) WHERE ID(n) = {id} return n',
    params: { id: Number(id) },
  }));
  db.cypher({ queries }, (err, results) => {
    res.json(results.map(r => (r.length ? r[0].n : null)));
  });
});

router.get('/expandNode', (req, res): void => {
  const { id } = req.query;
  if (!id) {
    res.json({});
    return;
  }
  const query = `match (o:Organization) where ID(o) = ${id}
match (o)-[r]->(o2)
return *`;
  doQuery(query, (data, data2) => res.json(data2));
});

router.get('/shortestPaths', (req, res): void => {
  const { ids = [] } = req.query;
  const fPart = `match ${ids.map(id => `(e${id})`).join(',')}
  where ${ids.map(id => `ID(e${id}) = ${id}`).join(' and ')}`;
  const sPart = pairwise(ids).map(
    ([id1, id2]) =>
      `match p${id1}${id2}=allShortestPaths((e${id1})-[*]-(e${id2}))`,
  ).join('\n');
  const lPart = pairwise(ids).map(
    ([id1, id2]) => `p${id1}${id2}`,
  ).join(',');

  const query = `${fPart}\n${sPart}\nreturn ${lPart} limit 50`;
  doQuery(query, data => res.json(data));
});

router.get('/', (req, res) => {
  const cb = (err, results) => {
    if (err) throw err;
    res.json({
      status: 'Okay',
      results,
    });
  };
  db.cypher(
    {
      query: sampleQuery,
      params: { company_name: 'Facebook' },
    },
    cb,
  );

  res.send('OK');
});
export default router;
