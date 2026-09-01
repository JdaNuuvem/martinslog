import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { ShellPublico } from '@/components/layout/shell-publico'
import { CalculadoraForm } from '@/components/calculadora-form'
import { ModalAtivarFluxo } from '@/components/modal-ativar-fluxo'
import { lerSessaoDoServidor } from '@/server/auth/sessao-servidor'

/**
 * Calculadora de frete — a porta de entrada, aberta a quem ainda não tem
 * conta.
 *
 * A moldura muda com a sessão, e é essa a diferença que importa:
 *
 * - **Visitante** recebe o `ShellPublico`: calculadora e nada mais. A
 *   navegação de vendedor (etiquetas, carteira, integrações, convites) some,
 *   porque ela só oferece telas que recusariam quem não tem conta — foi o
 *   motivo de a página ter sido fechada antes. Fechar resolvia o menu errado
 *   ao custo de perder quem chega para comparar preço, que é o começo de
 *   toda venda.
 * - **Autenticado** recebe o `AppShell` completo, como sempre.
 *
 * Quando um visitante escolhe um frete, o cadastro abre em cima da própria
 * cotação (`ModalCadastro`, disparado pela lista) e o leva ao fluxo de envio
 * com o serviço já escolhido.
 */
export default async function PaginaCalculadora() {
  const sessao = await lerSessaoDoServidor()

  if (sessao) {
    return (
      <AppShell nomeUsuario={sessao.nome} autenticado>
        {/* Só para quem entrou: o aviso trata de um percurso salvo na conta. */}
        <ModalAtivarFluxo />
        <CalculadoraForm autenticado />
      </AppShell>
    )
  }

  return (
    <ShellPublico
      hero={{
        eyebrow: 'Calculadora de frete',
        titulo: (
          <>
            Descubra quanto custa enviar{' '}
            <span className="text-sidebar-marcador">antes de fechar a venda</span>
          </>
        ),
        apoio:
          'Preço e prazo reais para qualquer CEP do Brasil, sem cadastro. Gostou do valor? Aí sim você cria a conta.',
      }}
    >
      <div className="flex flex-col gap-bloco">
        <CalculadoraForm />

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ARGUMENTOS.map((a) => (
            <li
              key={a.titulo}
              className="rounded-cartao border border-superficie-bloco bg-superficie-card p-4"
            >
              <p className="font-bold text-texto-principal">{a.titulo}</p>
              <p className="text-dado text-texto-secundario">{a.apoio}</p>
            </li>
          ))}
        </ul>

        <p className="text-dado text-texto-secundario">
          Já tem conta?{' '}
          <Link
            href="/login"
            className="font-medium text-brand-texto underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Entrar
          </Link>
        </p>
      </div>
    </ShellPublico>
  )
}

/**
 * Os quatro motivos ficam **abaixo** da calculadora, não acima.
 *
 * Quem chega aqui veio calcular um frete, e argumento de venda antes do
 * formulário é obstáculo. Depois do formulário ele responde a pergunta que
 * nasce logo em seguida — "posso confiar nesse preço?" — para quem ainda não
 * tem conta.
 */
const ARGUMENTOS = [
  {
    titulo: 'Sem cadastro',
    apoio: 'Consulte à vontade. Conta só na hora de enviar.',
  },
  {
    titulo: 'Preço já com desconto',
    apoio: 'O valor que aparece é o que você paga.',
  },
  {
    titulo: 'Seguro incluso',
    apoio: 'Toda carga viaja coberta.',
  },
  {
    titulo: 'Todo o Brasil',
    apoio: 'Frota própria nos principais corredores.',
  },
]
