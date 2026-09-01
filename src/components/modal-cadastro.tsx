'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { cadastroRequestSchema } from '@/lib/auth-schema'
import { destinoSeguro } from '@/lib/destino-seguro'

type EstadoFormulario = {
  nome: string
  documento: string
  email: string
  telefone: string
  senha: string
}

const ESTADO_INICIAL: EstadoFormulario = {
  nome: '',
  documento: '',
  email: '',
  telefone: '',
  senha: '',
}

type ErrosCampo = Partial<Record<keyof EstadoFormulario, string>>

const CAMPO =
  'rounded-campo border border-borda-campo bg-superficie-card px-3 py-2 text-texto-principal focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Cadastro sem sair da cotação.
 *
 * Quem acabou de comparar preços e clicou em um frete está no ponto mais
 * quente da jornada. Mandá-lo para outra página para criar conta custa o
 * contexto: a lista some da tela, e voltar depende de o destino ter sido
 * carregado corretamente na volta. O modal cria a conta ali mesmo e leva
 * direto ao fluxo de envio com a cotação escolhida.
 *
 * Usa o elemento `<dialog>` nativo em vez de uma `div` com `role="dialog"`:
 * ele já entrega fechar com Escape, foco preso dentro do diálogo e o resto
 * da página marcado como inerte — três coisas que costumam ficar pela
 * metade quando reimplementadas à mão.
 */
export function ModalCadastro({
  destino,
  aoFechar,
}: {
  /** Para onde levar depois de criar a conta — o fluxo com a cotação escolhida. */
  destino: string
  aoFechar: () => void
}) {
  const idBase = useId()
  /*
    O destino é montado aqui dentro do produto, não vem de parâmetro de URL —
    mas passa pela mesma peneira do login mesmo assim. É o caminho de
    navegação logo após criar conta, o instante em que a pessoa mais confia
    na tela; se um dia alguém montar este diálogo com um destino vindo de
    fora, a checagem já está no lugar em vez de depender de quem escreveu a
    chamada ter lembrado.
  */
  const destinoConferido = destinoSeguro(destino)
  const dialogo = useRef<HTMLDialogElement>(null)

  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL)
  const [erros, setErros] = useState<ErrosCampo>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    // `showModal` (e não o atributo `open`) é o que ativa o comportamento
    // modal: foco contido, Escape fechando e o fundo inerte.
    dialogo.current?.showModal()
  }, [])

  function atualizar<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroGeral(null)

    const analisado = cadastroRequestSchema.safeParse({
      nome: form.nome,
      documento: form.documento,
      email: form.email,
      telefone: form.telefone || undefined,
      senha: form.senha,
    })

    if (!analisado.success) {
      const campos = analisado.error.flatten().fieldErrors
      setErros({
        nome: campos.nome?.[0],
        documento: campos.documento?.[0],
        email: campos.email?.[0],
        telefone: campos.telefone?.[0],
        senha: campos.senha?.[0],
      })
      return
    }

    setErros({})
    setEnviando(true)

    try {
      const resposta = await fetch('/api/auth/cadastro', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(analisado.data),
      })

      const corpo = (await resposta.json().catch(() => ({}))) as {
        codigo?: string
        mensagem?: string
      }

      if (!resposta.ok) {
        if (corpo.codigo === 'EMAIL_JA_CADASTRADO') {
          setErroGeral('Já existe uma conta com este e-mail ou documento. Entre para continuar.')
        } else if (corpo.codigo === 'LIMITE_TENTATIVAS_EXCEDIDO') {
          setErroGeral('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
        } else {
          setErroGeral(corpo.mensagem ?? 'Não foi possível concluir o cadastro. Tente novamente.')
        }
        return
      }

      // Navegação completa, e não `router.push`: o roteador do cliente pode
      // ter em cache o redirecionamento para o login feito antes de a conta
      // existir, e o recém-cadastrado voltaria para o formulário sem
      // explicação. Recarregar faz o servidor decidir com o cookie novo.
      window.location.assign(destinoConferido)
    } catch {
      setErroGeral('Não foi possível conectar ao servidor. Verifique sua conexão.')
    } finally {
      setEnviando(false)
    }
  }

  const campos: { chave: keyof EstadoFormulario; rotulo: string; tipo: string; auto: string }[] = [
    { chave: 'nome', rotulo: 'Nome completo', tipo: 'text', auto: 'name' },
    { chave: 'documento', rotulo: 'CPF ou CNPJ', tipo: 'text', auto: 'off' },
    { chave: 'email', rotulo: 'E-mail', tipo: 'email', auto: 'email' },
    { chave: 'telefone', rotulo: 'Telefone (opcional)', tipo: 'tel', auto: 'tel' },
    { chave: 'senha', rotulo: 'Senha', tipo: 'password', auto: 'new-password' },
  ]

  return (
    <dialog
      ref={dialogo}
      data-testid="modal-cadastro"
      aria-labelledby={`${idBase}-titulo`}
      onClose={aoFechar}
      className="w-full max-w-md rounded-painel bg-superficie-card p-0 text-texto-principal shadow-flutuante backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 id={`${idBase}-titulo`} className="text-subtitulo font-semibold text-texto-principal">
            Crie sua conta para continuar
          </h2>
          <p className="text-dado text-texto-secundario">
            A cotação que você escolheu fica guardada: ao terminar, você cai direto no envio.
          </p>
        </div>

        <form onSubmit={enviar} noValidate className="flex flex-col gap-3">
          {campos.map((campo) => (
            // `htmlFor` explícito, e não só o input dentro do label: a
            // associação implícita depende de o rótulo não ter outro
            // conteúdo interativo, e quebra em silêncio quando alguém
            // acrescenta um. Aqui ela é declarada.
            <label
              key={campo.chave}
              htmlFor={`${idBase}-${campo.chave}`}
              className="flex flex-col gap-1 text-dado"
            >
              <span className="text-texto-secundario">{campo.rotulo}</span>
              <input
                id={`${idBase}-${campo.chave}`}
                type={campo.tipo}
                autoComplete={campo.auto}
                value={form[campo.chave]}
                onChange={(evento) => atualizar(campo.chave, evento.target.value)}
                aria-invalid={erros[campo.chave] ? true : undefined}
                aria-describedby={erros[campo.chave] ? `${idBase}-${campo.chave}-erro` : undefined}
                className={CAMPO}
              />
              {erros[campo.chave] ? (
                <span id={`${idBase}-${campo.chave}-erro`} role="alert" className="text-dado text-erro">
                  {erros[campo.chave]}
                </span>
              ) : null}
            </label>
          ))}

          {erroGeral ? (
            <p role="alert" className="rounded-campo bg-erro-fundo p-3 text-dado text-erro">
              {erroGeral}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="rounded-campo bg-brand px-4 py-2.5 font-medium text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {enviando ? 'Criando conta…' : 'Criar conta e continuar'}
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda-campo pt-4 text-dado">
          {/*
            Quem já tem conta precisa de saída, e ela leva o mesmo destino:
            entrar por aqui devolve a pessoa ao fluxo com a cotação escolhida,
            em vez de largá-la na home para recomeçar.
          */}
          <Link
            href={`/login?destino=${encodeURIComponent(destinoConferido)}`}
            className="font-medium text-brand-texto underline underline-offset-2"
          >
            Já tenho conta
          </Link>
          <button
            type="button"
            onClick={() => dialogo.current?.close()}
            className="rounded-campo border border-borda-campo px-4 py-2 font-medium text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Voltar à cotação
          </button>
        </div>
      </div>
    </dialog>
  )
}
