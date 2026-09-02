import { ConexaoWhatsapp } from '@/components/conexao-whatsapp'

export default function PaginaWhatsapp() {
  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">WhatsApp</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Avise o comprador pelo WhatsApp oficial, com o número da sua loja.
        </p>
        {/*
          O aviso mora aqui porque é aqui que a expectativa se quebra: quem
          abre esta tela costuma achar que basta colar um token e começar a
          mandar. A verificação da empresa na Meta leva dias e é o portão que
          não tem atalho — saber disso antes evita a impressão de que o
          sistema está com defeito.
        */}
        <p className="max-w-leitura text-dado text-texto-secundario">
          O WhatsApp oficial exige verificação da sua empresa na Meta, com CNPJ e documentos. Esse
          passo acontece no painel deles e costuma levar alguns dias.
        </p>
      </div>

      <ConexaoWhatsapp />
    </div>
  )
}
