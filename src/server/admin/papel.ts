import type { PapelUser } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import {
  AlteracaoDoProprioPapelError,
  UltimoAdminError,
  UsuarioNaoEncontradoError,
} from '@/domain/errors'

/**
 * Papel e acesso de um usuário — a parte administrativa mais sensível do
 * painel: quem entra aqui pode transformar qualquer conta em `ADMIN`.
 *
 * Três decisões atravessam o módulo, todas para que a única forma de virar
 * administrador (ou de expulsar alguém do sistema) seja por aqui, nunca por
 * um `UPDATE` direto:
 *
 * 1. **Autoproteção.** Ninguém muda o próprio papel, e o último `ADMIN`
 *    nunca é rebaixado. As duas checagens (contagem de admins e a escrita)
 *    vivem na mesma transação com `SELECT ... FOR UPDATE`, para que duas
 *    requisições simultâneas não rebaixem os dois últimos administradores ao
 *    mesmo tempo — sem o lock, cada uma leria "ainda sobra um" antes de a
 *    outra escrever.
 * 2. **Papel nunca vem do corpo sem revalidar quem chama.** Quem grava é
 *    sempre o handler de `/api/admin/usuarios/[id]/papel`, que já passou
 *    pela guarda administrativa — o papel do ator vem do banco, nunca do
 *    JSON da requisição.
 * 3. **Toda ação grava `AuditLog`** com `entidade: 'User'`, o ator, o alvo e
 *    o estado antes/depois, na mesma transação da escrita.
 */

export type ContextoAcesso = {
  userId: string
  papel: PapelUser
  emailVerificadoEm: Date | null
  sessoesAtivas: number
  ehProprio: boolean
  ultimoAdmin: boolean
}

/**
 * Contexto para a tela decidir o que pode oferecer: se o alvo é o próprio
 * ator (desabilita a troca de papel) e se ele é o último administrador
 * (desabilita o rebaixamento). A contagem de admins aqui é só para exibição
 * — a proteção de verdade mora em `alterarPapel`, dentro da transação.
 */
export async function obterContextoAcesso(
  actorUserId: string,
  userId: string,
): Promise<ContextoAcesso> {
  const usuario = await prisma.user.findUnique({
    where: { id: userId },
    select: { papel: true, emailVerificadoEm: true },
  })
  if (!usuario) {
    throw new UsuarioNaoEncontradoError('Usuário não encontrado.')
  }

  const [sessoesAtivas, totalAdmins] = await Promise.all([
    prisma.session.count({ where: { userId } }),
    prisma.user.count({ where: { papel: 'ADMIN' } }),
  ])

  return {
    userId,
    papel: usuario.papel,
    emailVerificadoEm: usuario.emailVerificadoEm,
    sessoesAtivas,
    ehProprio: actorUserId === userId,
    ultimoAdmin: usuario.papel === 'ADMIN' && totalAdmins <= 1,
  }
}

/**
 * Promove ou rebaixa o papel de um usuário.
 *
 * Recusa com `AlteracaoDoProprioPapelError` quando o alvo é o próprio ator —
 * um admin rebaixando a si mesmo trancaria a última conta administrativa do
 * lado de fora, e não há forma de desfazer isso pelo próprio painel.
 *
 * Ao rebaixar um `ADMIN`, a contagem de administradores é lida com
 * `SELECT ... FOR UPDATE` dentro da mesma transação da escrita: os registros
 * `ADMIN` ficam bloqueados até a transação terminar, então duas requisições
 * concorrentes rebaixando os dois últimos administradores serializam — a
 * segunda só lê a contagem depois que a primeira já commitou (ou não), e
 * portanto nunca as duas veem "ainda sobra um" ao mesmo tempo. Sem o lock, a
 * checagem e a escrita são dois passos separados e a corrida existe: as duas
 * transações leem "2 admins" antes de qualquer uma escrever, e as duas
 * concluem "não é o último" — mesmo rebaixando os dois.
 */
export async function alterarPapel(
  actorUserId: string,
  userId: string,
  novoPapel: PapelUser,
): Promise<{ papelAnterior: PapelUser; papelAtual: PapelUser }> {
  if (actorUserId === userId) {
    throw new AlteracaoDoProprioPapelError(
      'Você não pode alterar o próprio papel. Peça a outro administrador.',
    )
  }

  return prisma.$transaction(async (tx) => {
    const usuario = await tx.user.findUnique({ where: { id: userId }, select: { papel: true } })
    if (!usuario) {
      throw new UsuarioNaoEncontradoError('Usuário não encontrado.')
    }

    if (usuario.papel === novoPapel) {
      return { papelAnterior: usuario.papel, papelAtual: usuario.papel }
    }

    if (usuario.papel === 'ADMIN' && novoPapel === 'CLIENTE') {
      // Bloqueia todas as linhas ADMIN até o fim da transação — é isto que
      // serializa duas requisições concorrentes de rebaixamento em vez de
      // deixá-las ler a mesma contagem obsoleta.
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE papel = 'ADMIN' FOR UPDATE
      `
      if (admins.length <= 1) {
        throw new UltimoAdminError(
          'Este é o último administrador ativo. Promova outra conta antes de rebaixar esta.',
        )
      }
    }

    await tx.user.update({ where: { id: userId }, data: { papel: novoPapel } })

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: novoPapel === 'ADMIN' ? 'PAPEL_PROMOVIDO' : 'PAPEL_REBAIXADO',
        entidade: 'User',
        entidadeId: userId,
        antes: { papel: usuario.papel } as Prisma.InputJsonValue,
        depois: { papel: novoPapel } as Prisma.InputJsonValue,
      },
    })

    return { papelAnterior: usuario.papel, papelAtual: novoPapel }
  })
}

/**
 * Encerra todas as sessões da conta: apaga as linhas `Session` do banco, não
 * só o cookie de quem chama. É a ferramenta para uma conta comprometida —
 * qualquer dispositivo com o cookie antigo deixa de autenticar na próxima
 * leitura de sessão, porque `lerSessao`/`validarSessaoPorId` sempre
 * confirmam a sessão no banco.
 */
export async function encerrarSessoesUsuario(
  actorUserId: string,
  userId: string,
): Promise<{ sessoesEncerradas: number }> {
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!usuario) {
      throw new UsuarioNaoEncontradoError('Usuário não encontrado.')
    }

    const resultado = await tx.session.deleteMany({ where: { userId } })

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: 'SESSOES_ENCERRADAS',
        entidade: 'User',
        entidadeId: userId,
        antes: { sessoesAtivas: resultado.count } as Prisma.InputJsonValue,
        depois: { sessoesAtivas: 0 } as Prisma.InputJsonValue,
      },
    })

    return { sessoesEncerradas: resultado.count }
  })
}

/**
 * Marca o e-mail do usuário como verificado manualmente (suporte confirmou
 * por outro canal, por exemplo). Não desfaz — não existe "desverificar" pelo
 * painel, porque não há caso de uso real para isso e um botão a mais aqui só
 * seria uma forma nova de travar a própria conta por engano.
 */
export async function marcarEmailVerificado(
  actorUserId: string,
  userId: string,
): Promise<{ emailVerificadoEm: Date }> {
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.user.findUnique({
      where: { id: userId },
      select: { emailVerificadoEm: true },
    })
    if (!usuario) {
      throw new UsuarioNaoEncontradoError('Usuário não encontrado.')
    }

    const agora = new Date()
    await tx.user.update({ where: { id: userId }, data: { emailVerificadoEm: agora } })

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: 'EMAIL_VERIFICADO_MANUALMENTE',
        entidade: 'User',
        entidadeId: userId,
        antes: { emailVerificadoEm: usuario.emailVerificadoEm } as Prisma.InputJsonValue,
        depois: { emailVerificadoEm: agora } as Prisma.InputJsonValue,
      },
    })

    return { emailVerificadoEm: agora }
  })
}
