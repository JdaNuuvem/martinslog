/**
 * Repara o histórico das mensagens: separa o assunto do evento e recompõe o
 * texto dos SMS já enviados.
 *
 * Duas dívidas do desenho anterior:
 *
 *  1. O assunto do e-mail era concatenado no evento ("PAGO — Pagamento
 *     confirmado — pedido PED-X") porque não havia coluna. Isso quebrava o
 *     filtro: cada e-mail virava um evento diferente, e "filtrar por PAGO" não
 *     trazia nenhum.
 *
 *  2. O texto do SMS era composto no envio e descartado. A tela dizia
 *     "PEDIDO_PAGO · enviada" e não o que a pessoa leu.
 *
 * O SMS é recomposto a partir do template e dos valores de HOJE, e isso é uma
 * APROXIMAÇÃO — não o texto congelado. Vale porque o template não mudou desde
 * o primeiro envio e o código de rastreio de um envio não muda depois de
 * emitido; e vale mais do que deixar a coluna vazia, que não responde nada.
 * O que sai daqui fica marcado com o prefixo `~` para ninguém confundir uma
 * reconstrução com o registro do envio.
 *
 * Uso: DATABASE_URL=… node scripts/reparar-mensagens.mjs [--aplicar]
 */
import { createHash } from 'crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const aplicar = process.argv.includes('--aplicar')

/** O mesmo `compor` de `src/domain/mensagem/texto.ts`, sem o build do Next. */
function compor(modelo, valores) {
  return modelo
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_t, chave) => valores[chave.toLowerCase()] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[\s]*[:\-–—,]\s*$/, '')
    .trim()
}

function primeiroNome(completo) {
  return String(completo ?? '').trim().split(/\s+/)[0] ?? ''
}

async function separarAssunto() {
  const comAssuntoNoEvento = await prisma.mensagemEnvio.findMany({
    where: { canal: 'EMAIL', assunto: null, evento: { contains: ' — ' } },
    select: { id: true, evento: true, canal: true, para: true, criadoEm: true, idExterno: true },
  })

  console.log(`[assunto] ${comAssuntoNoEvento.length} e-mails com o assunto preso no evento`)
  if (!aplicar) return

  let feitos = 0
  let colidiram = 0

  for (const m of comAssuntoNoEvento) {
    // "PAGO — Pagamento confirmado — pedido PED-X" → evento "PAGO",
    // assunto "Pagamento confirmado — pedido PED-X". O primeiro separador é o
    // que divide; os seguintes fazem parte do assunto.
    const corte = m.evento.indexOf(' — ')
    const evento = m.evento.slice(0, corte)
    const assunto = m.evento.slice(corte + 3)

    /*
      A IDENTIDADE tem que vir junto, no mesmo update.

      Enquanto o assunto morava dentro do evento, ele é que tornava cada linha
      única — por acidente. Separá-lo derruba milhares de e-mails para o mesmo
      `(perfil, PAGO, EMAIL, null, null, null, null)` e a segunda linha colide.
      Estes foram importados antes de a identidade sintética existir, então
      chegaram com `idExterno` nulo.

      Mesma semente do serviço, e o mesmo prefixo `reportado:` — quem ler a
      coluna depois precisa saber que o valor foi construído aqui.
    */
    const idExterno =
      m.idExterno ??
      `reportado:${createHash('sha1')
        .update([m.canal, evento, m.para.trim().toLowerCase(), m.criadoEm.toISOString(), assunto].join('|'))
        .digest('hex')
        .slice(0, 24)}`

    try {
      await prisma.mensagemEnvio.update({
        where: { id: m.id },
        data: { evento, assunto, idExterno },
      })
      feitos++
    } catch (erro) {
      /*
        Duas mensagens de fato idênticas — mesmo destinatário, mesmo evento,
        mesmo assunto, mesmo segundo. Deixar como está é melhor do que apagar
        uma: o histórico continua legível, só não fica separado.
      */
      if (erro?.code === 'P2002') colidiram++
      else throw erro
    }

    if ((feitos + colidiram) % 500 === 0) console.log(`   … ${feitos + colidiram}`)
  }

  console.log(`[assunto] ${feitos} separados, ${colidiram} deixados como estavam (duplicata real)`)
}

async function recomporSms() {
  const semTexto = await prisma.mensagemEnvio.findMany({
    where: { canal: { in: ['SMS', 'WHATSAPP'] }, texto: null },
    select: {
      id: true,
      shipmentId: true,
      template: { select: { previa: true } },
      pedido: { select: { clienteNome: true, valorCentavos: true, checkoutUrl: true } },
      perfil: { select: { nome: true, nomeExibicao: true } },
    },
  })

  console.log(`[texto] ${semTexto.length} mensagens sem o texto registrado`)
  if (!aplicar) return

  const base = process.env.APP_URL ?? 'https://app.martinslog.net'
  let feitos = 0
  let semTemplate = 0

  for (const m of semTexto) {
    if (!m.template) {
      semTemplate++
      continue
    }

    const valores = { loja: m.perfil.nomeExibicao?.trim() || m.perfil.nome }

    if (m.pedido) {
      valores.cliente = primeiroNome(m.pedido.clienteNome)
      valores.valor = (m.pedido.valorCentavos / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })
      valores.link_checkout = m.pedido.checkoutUrl ?? ''
    }

    if (m.shipmentId) {
      const envio = await prisma.shipment.findUnique({
        where: { id: m.shipmentId },
        select: { codigoRastreio: true, destinatario: true },
      })
      if (envio?.codigoRastreio) {
        valores.codigo_rastreio = envio.codigoRastreio
        valores.link_rastreio = `${base}/r/${envio.codigoRastreio}`
      }
      const dest = envio?.destinatario
      if (!valores.cliente && dest?.nome) valores.cliente = primeiroNome(dest.nome)
    }

    await prisma.mensagemEnvio.update({
      where: { id: m.id },
      // `~` na frente: isto é uma RECONSTRUÇÃO, não o texto congelado no envio.
      // Quem ler a tela precisa poder distinguir os dois sem perguntar.
      data: { texto: `~ ${compor(m.template.previa, valores)}` },
    })
    feitos++
  }

  console.log(`[texto] ${feitos} recompostos, ${semTemplate} sem template (impossível recompor)`)
}

;(async () => {
  console.log(aplicar ? '=== APLICANDO ===' : '=== simulação ===')
  await separarAssunto()
  await recomporSms()
})()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
