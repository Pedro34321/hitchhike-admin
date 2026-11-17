import { test } from 'node:test';
import assert from 'node:assert/strict';
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const { getApps } = await import('firebase-admin/app');
const { statusExibicaoCarona } = await import('../firebaseMotoristas.js');
const { statusCalculado, resumoVisao } = await import('../public/visaoResumo.js');

const agora = Date.parse('2026-11-10T18:00:00.000Z');
const futuro = Date.parse('2099-01-01T12:00:00.000Z');
const passado = Date.parse('2020-01-01T12:00:00.000Z');

test('o status da visão geral segue o cálculo do Android e não consulta o Firebase', () => {
  const casos = [
    ['CANCELADA', futuro, 2],
    ['CANCELADA', passado, 0],
    ['ABERTA', passado, 2],
    ['ABERTA', futuro, 2],
    ['ABERTA', futuro, 0],
    ['LOTADA', futuro, 2],
    ['FINALIZADA', futuro, 2],
    ['ABERTA', null, 2],
    ['ABERTA', futuro, null],
    ['ABERTA', Number.NaN, 2]
  ];
  for (const [status, saida, vagas] of casos) {
    assert.equal(statusCalculado(status, saida, vagas, agora), statusExibicaoCarona(status, saida, vagas, agora));
  }
  assert.equal(getApps().length, 0);
});

test('os indicadores usam só as listas carregadas e distinguem indisponível de zero', () => {
  const agoraLocal = new Date(2026, 10, 10, 15, 0, 0).getTime();
  const iso = (ano, mes, dia, hora) => new Date(ano, mes, dia, hora).toISOString();
  const resumo = resumoVisao({
    usuarios: { disponivel: true, limitado: true, usuarios: [
      { nome: 'Ana', condutorValidado: true, email: 'ana@example.com' },
      { nome: 'Bia', condutorValidado: 'true', email: 'bia@example.com' },
      { nome: 'Caio', condutorValidado: false }
    ] },
    caronas: { disponivel: true, limitado: false, indicadores: { abertas: 99, encerradas: 99 }, caronas: [
      { motorista: 'Ana', origem: 'Senac', destino: 'Metrô', saida: iso(2026, 10, 10, 8), statusArmazenado: 'ABERTA', statusExibicao: 'ABERTA', vagasDisponiveis: 2, email: 'ana@example.com', motoristaUid: 'uid-ana' },
      { motorista: 'Ana', origem: 'Antiga', destino: 'Longe', saida: iso(2026, 9, 1, 8), statusArmazenado: 'ABERTA', vagasDisponiveis: 2 },
      { motorista: 'Ana', origem: 'Amanhã', destino: 'Campus', saida: iso(2026, 10, 11, 8), statusArmazenado: 'ABERTA', vagasDisponiveis: 1, email: 'segredo@example.com' },
      { motorista: 'Ana', origem: 'Lotada', destino: 'Campus', saida: iso(2026, 10, 12, 8), statusArmazenado: 'ABERTA', vagasDisponiveis: 0 }
    ] },
    solicitacoes: { disponivel: true, solicitacoes: [
      { status: 'PENDENTE', email: 'pedido@example.com' },
      { status: 'pendente' },
      { status: 'aprovado' },
      { status: 'APROVADA' }
    ] },
    agoraMillis: agoraLocal
  });
  assert.equal(resumo.usuarios, 3);
  assert.equal(resumo.motoristasValidados, 1);
  assert.equal(resumo.caronas, 4);
  assert.equal(resumo.encerradas, 2);
  assert.equal(resumo.abertas, 1);
  assert.equal(resumo.pendentes, 1);
  assert.equal(resumo.limitadoUsuarios, true);
  assert.equal(resumo.limitadoCaronas, false);
  assert.equal(resumo.atividade.length, 7);
  assert.equal(resumo.atividade.reduce((soma, dia) => soma + dia.n, 0), 1);
  assert.equal(resumo.recentes[0].origem, 'Lotada');
  assert.equal(resumo.recentes[0].statusExibicao, 'LOTADA');
  assert.equal(resumo.recentes.find(item => item.origem === 'Senac').statusExibicao, 'ENCERRADA');
  for (const item of resumo.recentes) assert.deepEqual(Object.keys(item).sort(), ['destino', 'motorista', 'origem', 'saida', 'statusExibicao']);
  assert.doesNotMatch(JSON.stringify(resumo.recentes), /example.com|uid-ana|motoristaUid/);
  const indisponivel = resumoVisao({
    usuarios: { disponivel: false, usuarios: [{ condutorValidado: true }] },
    caronas: { disponivel: false, indicadores: { abertas: 0, encerradas: 0 }, caronas: [{ statusArmazenado: 'ABERTA', vagasDisponiveis: 2, saida: iso(2026, 10, 11, 8) }] },
    solicitacoes: { disponivel: false, solicitacoes: [{ status: 'PENDENTE' }] },
    agoraMillis: agoraLocal
  });
  assert.equal(indisponivel.usuarios, null);
  assert.equal(indisponivel.motoristasValidados, null);
  assert.equal(indisponivel.caronas, null);
  assert.equal(indisponivel.encerradas, null);
  assert.equal(indisponivel.abertas, null);
  assert.equal(indisponivel.pendentes, null);
  assert.equal(indisponivel.atividade, null);
  assert.equal(indisponivel.recentes, null);
  const vazio = resumoVisao({
    usuarios: { disponivel: true, usuarios: [] },
    caronas: { disponivel: true, caronas: [] },
    solicitacoes: { disponivel: true, solicitacoes: [] },
    agoraMillis: agoraLocal
  });
  assert.equal(vazio.usuarios, 0);
  assert.equal(vazio.caronas, 0);
  assert.equal(vazio.encerradas, 0);
  assert.equal(vazio.abertas, 0);
  assert.equal(vazio.pendentes, 0);
  assert.equal(vazio.atividade.length, 7);
  const antes = resumoVisao({
    usuarios: { disponivel: true, usuarios: [{ condutorValidado: false }] },
    caronas: { disponivel: true, caronas: [] },
    solicitacoes: { disponivel: true, solicitacoes: [{ status: 'PENDENTE' }] },
    agoraMillis: agoraLocal
  });
  const aprovado = resumoVisao({
    usuarios: { disponivel: true, usuarios: [{ condutorValidado: true }] },
    caronas: { disponivel: true, caronas: [] },
    solicitacoes: { disponivel: true, solicitacoes: [{ status: 'APROVADA' }] },
    agoraMillis: agoraLocal
  });
  const recusado = resumoVisao({
    usuarios: { disponivel: true, usuarios: [{ condutorValidado: false }] },
    caronas: { disponivel: true, caronas: [] },
    solicitacoes: { disponivel: true, solicitacoes: [{ status: 'RECUSADA' }] },
    agoraMillis: agoraLocal
  });
  assert.equal(antes.pendentes, 1);
  assert.equal(antes.motoristasValidados, 0);
  assert.equal(aprovado.pendentes, 0);
  assert.equal(aprovado.motoristasValidados, 1);
  assert.equal(recusado.pendentes, 0);
  assert.equal(recusado.motoristasValidados, 0);
  const cancelada = resumoVisao({
    usuarios: { disponivel: true, usuarios: [] },
    caronas: { disponivel: true, caronas: [{ saida: iso(2020, 0, 1, 8), statusArmazenado: 'CANCELADA', vagasDisponiveis: 0 }] },
    solicitacoes: { disponivel: true, solicitacoes: [] },
    agoraMillis: agoraLocal
  });
  assert.equal(cancelada.caronas, 1);
  assert.equal(cancelada.encerradas, 0);
  assert.equal(cancelada.abertas, 0);
  assert.equal(getApps().length, 0);
});
