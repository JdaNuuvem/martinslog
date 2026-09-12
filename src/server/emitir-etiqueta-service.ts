import { prisma } from "@/infra/db/client";
import { EnvioNaoEncontradoError } from "@/domain/errors";
import { garantirTransicao } from "@/domain/shipment/estados";
import { calcularOcorridoEm, gerarRoteiro } from "@/domain/simulacao/roteiro";
import type { LocalidadeSimulacao } from "@/domain/simulacao/tipos";
import { atribuirCodigoRastreio } from "./codigo-rastreio-service";
import { enfileirarEvento } from "./webhook-service";
import { catalogoDoUsuario } from "./status-rastreio-service";
import { obterTemplate } from "./template-rastreio-service";
import { gerarRoteiroDeTemplate } from "@/domain/rastreio/template-rastreio";
import { obterConfigSimulacao } from "./simulacao-config";
import { registrarLead } from "./lead-service";

/**
 * Emissão da etiqueta: é aqui que o envio ganha código de rastreio e que a
 * linha do tempo da simulação nasce inteira, já datada no futuro
 * (docs/superpowers/specs/2026-08-31-simulacao-transporte.md, seção 1).
 *
 * Não existe job, fila nem cron por trás: gravar o futuro na emissão é o que
 * torna a consulta uma comparação de data e a timeline determinística — duas
 * consultas no mesmo instante devolvem exatamente os mesmos eventos.
 */

/**
 * Extrai cidade e UF do endereço copiado dentro do envio. Os campos são JSON
 * (`Shipment.remetente` / `Shipment.destinatario`), então chegam sem tipo do
 * Prisma; o resto do endereço não interessa à simulação, e é bom que não
 * interesse: a timeline só carrega cidade e UF, nunca nome nem logradouro.
 */
function localidadeDoEndereco(
  endereco: unknown,
  papel: string,
): LocalidadeSimulacao {
  const registro = endereco as { cidade?: unknown; uf?: unknown } | null;

  if (
    typeof registro?.cidade !== "string" ||
    typeof registro?.uf !== "string"
  ) {
    throw new EnvioNaoEncontradoError(`Envio sem cidade/UF de ${papel}.`);
  }

  return { cidade: registro.cidade, uf: registro.uf };
}

/**
 * Atribui o código de rastreio, materializa a timeline do cenário do envio e
 * move `RELEASED` → `GENERATED`, tudo em uma transação: ou o envio sai da
 * emissão com código e linha do tempo completos, ou nada é gravado.
 *
 * **Chamar duas vezes o mesmo envio é recusado**, de propósito. A segunda
 * chamada morre em `garantirTransicao` (o status já é `GENERATED`) antes de
 * qualquer escrita, então não há código novo nem timeline duplicada. Emissão
 * dupla silenciosa seria pior que erro visível: consumiria sequência do
 * código de rastreio e duplicaria a linha do tempo que o cliente já viu.
 * Quem precisa retentar apenas o PDF lê o envio já emitido e gera o arquivo —
 * não passa por aqui.
 *
 * Não recebe `userId`: quem chama já provou a posse (`pagarEnvio`) ou é
 * administrador. A checagem de dono é responsabilidade da rota HTTP.
 */
export async function emitirEtiqueta(
  shipmentId: string,
): Promise<{ codigoRastreio: string }> {
  // Um único relógio para toda a emissão. Dois `new Date()` produziriam
  // offsets calculados a partir de instantes diferentes, e a timeline sairia
  // internamente inconsistente.
  const simulacaoIniciadaEm = new Date();

  const resultado = await prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        // Necessário para resolver o catálogo de status da conta dona do
        // envio; o resto do envio continua fora deste select de propósito.
        userId: true,
        status: true,
        cenario: true,
        remetente: true,
        destinatario: true,
        service: { select: { prazoBase: true } },
      },
    });

    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`);
    }

    // Antes de qualquer escrita — é esta linha que dá a idempotência da
    // emissão, sem depender de um `if` de ocasião.
    garantirTransicao(envio.status, "GENERATED");

    const { fatorVelocidade, operador } = await obterConfigSimulacao(tx);

    const codigoRastreio = await atribuirCodigoRastreio(tx, envio.id);

    // Dentro da transação: se a leitura do catálogo falhar, a emissão
    // aborta e o envio segue em RELEASED, retentável. A timeline é imutável
    // depois de gravada, então emitir com o texto errado seria pior que não
    // emitir.
    const catalogo = await catalogoDoUsuario(envio.userId, tx);

    const origem = localidadeDoEndereco(envio.remetente, "remetente");
    const destino = localidadeDoEndereco(envio.destinatario, "destinatário");

    // Template da conta, quando existe e está ligado, **substitui** o roteiro
    // por cenário em vez de se somar a ele: quem montou um template declarou
    // o percurso inteiro, e mesclar com a espinha automática produziria
    // eventos que a conta não pediu.
    const template = await obterTemplate(envio.userId, tx);

    const roteiro = template?.ativo
      ? gerarRoteiroDeTemplate(template.passos, origem, destino)
      : gerarRoteiro({
          cenario: envio.cenario,
          prazoDias: envio.service.prazoBase,
          origem,
          destino,
          operador,
          textos: catalogo.textos,
          etapasExtras: catalogo.etapasExtras,
          posicoesDias: catalogo.posicoesDias,
        });

    await tx.trackingEvent.createMany({
      data: roteiro.map((evento) => ({
        shipmentId: envio.id,
        sequencia: evento.sequencia,
        offsetMinutos: evento.offsetMinutos,
        codigo: evento.codigo,
        status: evento.codigo,
        titulo: evento.titulo,
        descricao: evento.descricao,
        unidadeOrigem: evento.unidadeOrigem,
        unidadeDestino: evento.unidadeDestino,
        cidade: evento.cidade,
        uf: evento.uf,
        ocorridoEm: calcularOcorridoEm(
          simulacaoIniciadaEm,
          evento.offsetMinutos,
          fatorVelocidade,
        ),
      })),
    });

    await tx.shipment.update({
      where: { id: envio.id },
      data: {
        status: "GENERATED",
        geradoEm: simulacaoIniciadaEm,
        simulacaoIniciadaEm,
        // Copiado, não referenciado: mudar a velocidade global depois não
        // pode reescrever a linha do tempo de quem já está em trânsito.
        fatorSimulacao: fatorVelocidade,
      },
    });

    // Depois do código, dos eventos E do novo status.
    //
    // O payload é congelado na leitura da linha, então enfileirar antes do
    // `update` fazia `order.generated` sair anunciando `status: "RELEASED"` —
    // o estado anterior. Quem programasse pelo campo `status` nunca veria
    // GENERATED chegar, e trataria a emissão da etiqueta como se ela não
    // tivesse acontecido.
    //
    // Continua sendo a última coisa da transação, e continua só gravando
    // linhas em WebhookDelivery: nenhuma requisição de rede acontece aqui,
    // para que o tempo de resposta de um servidor de terceiro não possa
    // derrubar a emissão.
    await enfileirarEvento(envio.id, "order.generated", tx);

    return { codigoRastreio };
  });

  /*
    O lead entra FORA da transação, de propósito.

    A transação acima emite o código de rastreio e cria a timeline inteira —
    é o caminho crítico da emissão. Enfiar a busca e a eventual fusão de
    leads lá dentro alongaria essa transação por causa de um subproduto, e
    um erro no subproduto desfaria a etiqueta.
  */
  await registrarLeadDoEnvio(shipmentId);

  return resultado;
}

/**
 * Põe o destinatário do envio na base de leads.
 *
 * É a única origem que traz CPF, e por isso a que mais importa para a
 * identidade: sem ela, a cascata quase nunca tem chave forte para usar.
 */
async function registrarLeadDoEnvio(shipmentId: string): Promise<void> {
  try {
    const envio = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { perfilId: true, sandbox: true, destinatario: true, geradoEm: true },
    });

    // Envio de teste não avisa nem cadastra ninguém: o comprador não existe.
    if (!envio || envio.sandbox) return;

    const destinatario = envio.destinatario as {
      nome?: string;
      email?: string;
      telefone?: string;
      documento?: string;
    } | null;

    if (!destinatario) return;

    await registrarLead({
      tipo: "ENVIO",
      perfilId: envio.perfilId,
      shipmentId,
      ocorridoEm: envio.geradoEm ?? new Date(),
      nome: destinatario.nome,
      email: destinatario.email,
      telefone: destinatario.telefone,
      cpf: destinatario.documento,
    });
  } catch (error) {
    console.error("Falha ao registrar o lead do envio", { shipmentId, cause: error });
  }
}
