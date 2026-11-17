// Cálculo financeiro do Split 1:1 (Mercado Pago), em centavos inteiros.
// A tarifa do Mercado Pago é apenas ESTIMADA (percentual configurável): o valor real só é
// conhecido após a aprovação e é conferido na reconciliação (fee_details / net_received_amount).

const LIMITE_TARIFA_PERCENT = 20;

/** Lê o percentual de tarifa estimada (ex.: "0.99" ou "0,99") e devolve pontos-base (99). */
export function lerTarifaEstimadaBp(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(texto)) return null;
  const percentual = Number(texto);
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > LIMITE_TARIFA_PERCENT) return null;
  return Math.round(percentual * 100);
}

/**
 * Divide o total entre motorista, Hitchhike e Mercado Pago (estimativa).
 *  marketplaceFee = comissão bruta (25%) − tarifa MP estimada (arredondada para CIMA, a favor do motorista).
 * Nada aqui garante o repasse: só a reconciliação com a API prova o valor real.
 */
export function calcularSplit({ baseCentavos, taxaCentavos, tarifaBp }) {
  const inteiros = [baseCentavos, taxaCentavos, tarifaBp].every(n => Number.isSafeInteger(n) && n >= 0);
  if (!inteiros) return { viavel: false, motivo: 'parametros_invalidos' };
  const totalCentavos = baseCentavos + taxaCentavos;
  const tarifaEstimadaCentavos = Math.floor((totalCentavos * tarifaBp + 9999) / 10000);
  const marketplaceFeeCentavos = taxaCentavos - tarifaEstimadaCentavos;
  if (marketplaceFeeCentavos < 1) return { viavel: false, motivo: 'comissao_insuficiente_para_tarifa' };
  return {
    viavel: true,
    baseCentavos,
    taxaCentavos,
    totalCentavos,
    tarifaEstimadaCentavos,
    marketplaceFeeCentavos,
    motoristaPrevistoCentavos: totalCentavos - tarifaEstimadaCentavos - marketplaceFeeCentavos,
    hitchhikeLiquidoPrevistoCentavos: marketplaceFeeCentavos,
    estimado: true
  };
}

const centavos = valor => (typeof valor === 'number' && Number.isFinite(valor)
  ? Math.round(Number((valor * 100).toFixed(4))) : null);

/**
 * Extrai a conferência financeira de um pagamento consultado na API do Mercado Pago.
 * Só usa campos presentes; se faltarem, a reconciliação fica INDISPONIVEL (nunca presume).
 */
export function conferirRepasse(mp, baseCentavos) {
  const liquido = centavos(mp?.transaction_details?.net_received_amount);
  const detalhes = Array.isArray(mp?.fee_details) ? mp.fee_details : [];
  const soma = tipos => {
    const itens = detalhes.filter(f => tipos.includes(f?.type) && centavos(f?.amount) !== null);
    return itens.length ? itens.reduce((t, f) => t + centavos(f.amount), 0) : null;
  };
  const tarifaRealCentavos = soma(['mercadopago_fee']);
  const comissaoRealCentavos = soma(['application_fee', 'marketplace_fee']);
  if (liquido === null || tarifaRealCentavos === null || comissaoRealCentavos === null) {
    return { situacao: 'INDISPONIVEL', tarifaRealCentavos, comissaoRealCentavos, liquidoMotoristaCentavos: liquido };
  }
  const diferenca = liquido - baseCentavos;
  return {
    situacao: diferenca >= 0 ? 'CONFERIDA' : 'DIVERGENTE',
    tarifaRealCentavos,
    comissaoRealCentavos,
    liquidoMotoristaCentavos: liquido,
    diferencaMotoristaCentavos: diferenca
  };
}
