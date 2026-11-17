export function statusCalculado(statusArmazenado, saidaMillis, vagasDisponiveis, agoraMillis) {
  if (statusArmazenado === 'CANCELADA') return 'CANCELADA';
  if (typeof saidaMillis === 'number' && saidaMillis <= agoraMillis) return 'ENCERRADA';
  const vagas = typeof vagasDisponiveis === 'number' ? vagasDisponiveis : 0;
  if (vagas <= 0 || statusArmazenado === 'LOTADA') return 'LOTADA';
  return 'ABERTA';
}

function millisSaida(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const valor = new Date(iso).getTime();
  return Number.isNaN(valor) ? null : valor;
}

function diaLocal(millis) {
  const data = new Date(millis);
  return [data.getFullYear(), String(data.getMonth() + 1).padStart(2, '0'), String(data.getDate()).padStart(2, '0')].join('-');
}

export function classificarCarona(carona, agoraMillis) {
  const saidaMillis = millisSaida(carona?.saida);
  return {
    motorista: typeof carona?.motorista === 'string' ? carona.motorista : '',
    origem: typeof carona?.origem === 'string' ? carona.origem : '',
    destino: typeof carona?.destino === 'string' ? carona.destino : '',
    saida: saidaMillis === null ? '' : new Date(saidaMillis).toISOString(),
    statusExibicao: statusCalculado(carona?.statusArmazenado, saidaMillis, carona?.vagasDisponiveis, agoraMillis)
  };
}

export function atividadeSeteDias(caronas, agoraMillis) {
  const inicio = new Date(agoraMillis);
  inicio.setHours(0, 0, 0, 0);
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const data = new Date(inicio);
    data.setDate(inicio.getDate() - i);
    dias.push({
      chave: diaLocal(data.getTime()),
      rotulo: data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      n: 0
    });
  }
  for (const carona of caronas) {
    const millis = millisSaida(carona.saida);
    if (millis === null) continue;
    const dia = dias.find(item => item.chave === diaLocal(millis));
    if (dia) dia.n += 1;
  }
  return dias;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

export function resumoVisao({ usuarios, caronas, solicitacoes, agoraMillis = Date.now() } = {}) {
  const usuariosOk = usuarios?.disponivel === true;
  const caronasOk = caronas?.disponivel === true;
  const solicitacoesOk = solicitacoes?.disponivel === true;
  const usuariosLidos = lista(usuarios?.usuarios);
  const caronasLidas = lista(caronas?.caronas);
  const solicitacoesLidas = lista(solicitacoes?.solicitacoes);
  const classificadas = caronasOk ? caronasLidas.map(carona => classificarCarona(carona, agoraMillis)) : [];
  const contar = tipo => classificadas.filter(carona => carona.statusExibicao === tipo).length;
  return {
    usuarios: usuariosOk ? usuariosLidos.length : null,
    motoristasValidados: usuariosOk ? usuariosLidos.filter(usuario => usuario?.condutorValidado === true).length : null,
    caronas: caronasOk ? caronasLidas.length : null,
    encerradas: caronasOk ? contar('ENCERRADA') : null,
    abertas: caronasOk ? contar('ABERTA') : null,
    pendentes: solicitacoesOk ? solicitacoesLidas.filter(item => item?.status === 'PENDENTE').length : null,
    limitadoUsuarios: usuariosOk && usuarios.limitado === true,
    limitadoCaronas: caronasOk && caronas.limitado === true,
    atividade: caronasOk ? atividadeSeteDias(classificadas, agoraMillis) : null,
    recentes: caronasOk ? classificadas.slice().sort((a, b) => (b.saida || '').localeCompare(a.saida || '')).slice(0, 5) : null
  };
}

globalThis.resumoVisao = resumoVisao;
