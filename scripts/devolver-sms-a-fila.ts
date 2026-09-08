/**
 * Devolve à fila os SMS que não chegaram ao comprador por culpa da
 * configuração, não do número dele.
 *
 * Dois casos, com a mesma raiz: o canal rodou antes de estar pronto.
 *
 *  1. **Marcados ENVIADA sem sair.** Sem `SMS_PROVEDOR`/`SMS_CHAVE`, o canal
 *     cai no provedor `registrado`, que escreve a mensagem no log e devolve
 *     OK. A fila esvazia, o painel diz ENVIADA, e ninguém recebeu nada. Fila
 *     parada é visível; fila esvaziada em falso é mentira.
 *
 *  2. **Desistiram com 403 do provedor.** `PARÂMETRO KEY NÃO INFORMADO` é o
 *     SMSDev dizendo que a chave não chegou na requisição. Falha de
 *     autenticação é permanente por política — e com razão, porque insistir
 *     com credencial errada não melhora. Só que aqui ela era TRANSITÓRIA: a
 *     chave estava sendo configurada naquele minuto. Trinta e quatro
 *     compradores desistiram com UMA tentativa gasta, entre 21:15 e 21:58, e o
 *     primeiro envio bem-sucedido foi 21:59.
 *
 * O que NÃO volta: mensagem cancelada de propósito na migração (a decisão de
 * não avisar retroativamente), telefone recusado pela operadora, e qualquer
 * uma entregue de verdade por um provedor real.
 *
 * O texto é limpo junto. Ele será recomposto no envio, com o código de
 * rastreio de então — e o que está gravado é o texto de uma tentativa que
 * ninguém leu.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/devolver-sms-a-fila.ts [--aplicar]
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../src/infra/db/client'

const aplicar = process.argv.includes('--aplicar')

const ALVOS: { nome: string; onde: Prisma.MensagemEnvioWhereInput }[] = [
  {
    nome: 'marcadas ENVIADA mas só registradas em log',
    onde: { provedor: 'registrado', status: 'ENVIADA' },
  },
  {
    nome: 'desistiram com 403 (chave ainda não configurada)',
    onde: { canal: 'SMS', status: 'DESISTIU', erro: { contains: 'KEY NÃO INFORMADO' } },
  },
]

async function main() {
  let total = 0

  for (const alvo of ALVOS) {
    const quantas = await prisma.mensagemEnvio.count({ where: alvo.onde })
    console.log(`${String(quantas).padStart(4)}  ${alvo.nome}`)

    const amostra = await prisma.mensagemEnvio.findMany({
      where: alvo.onde,
      select: { para: true, evento: true, criadoEm: true },
      take: 2,
    })
    for (const m of amostra) {
      console.log(`      ${m.para}  ${m.evento}  ${m.criadoEm.toISOString().slice(0, 16)}`)
    }

    if (!aplicar) continue

    const { count } = await prisma.mensagemEnvio.updateMany({
      where: alvo.onde,
      data: {
        status: 'PENDENTE',
        provedor: null,
        idExterno: null,
        enviadaEm: null,
        texto: null,
        erro: null,
        tentativas: 0,
        // Vencida: sai no próximo disparo do agendador.
        proximaTentativaEm: new Date(),
      },
    })
    total += count
  }

  console.log(aplicar ? `\n${total} devolvidas à fila.` : '\n(simulação — passe --aplicar)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
