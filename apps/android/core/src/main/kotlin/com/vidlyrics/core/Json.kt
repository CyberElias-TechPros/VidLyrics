package com.vidlyrics.core

/**
 * A tiny, strict, dependency-free JSON implementation.
 *
 * Why not kotlinx.serialization or org.json? The core module is deliberately
 * pure JVM Kotlin: it compiles with plain kotlinc, runs in JVM unit tests, and
 * can be reused by a desktop/CLI build without an Android classpath. A small
 * strict parser also lets us reject hostile project files field-by-field in
 * ProjectCodec instead of relying on reflection-based deserialisation (which
 * is exactly how a malicious import file gets to instantiate unexpected types).
 */
sealed interface JsonValue {
    data object Null : JsonValue
    data class Bool(val value: Boolean) : JsonValue
    data class Num(val value: Double) : JsonValue
    data class Str(val value: String) : JsonValue
    data class Arr(val value: List<JsonValue>) : JsonValue
    data class Obj(val value: Map<String, JsonValue>) : JsonValue

    val asString: String? get() = (this as? Str)?.value
    val asBoolean: Boolean? get() = (this as? Bool)?.value
    val asDouble: Double? get() = (this as? Num)?.value
    val asLong: Long? get() = (this as? Num)?.value?.let { if (it.isFinite() && it >= Long.MIN_VALUE && it <= Long.MAX_VALUE) Math.round(it) else null }
    val asInt: Int? get() = asLong?.let { if (it in Int.MIN_VALUE..Int.MAX_VALUE) it.toInt() else null }
    val asArray: List<JsonValue>? get() = (this as? Arr)?.value
    val asObject: Map<String, JsonValue>? get() = (this as? Obj)?.value

    fun get(key: String): JsonValue? = (this as? Obj)?.value?.get(key)
    fun string(key: String, default: String = ""): String = get(key)?.asString ?: default
    fun long(key: String, default: Long = 0L): Long = get(key)?.asLong ?: default
    fun double(key: String, default: Double = 0.0): Double = get(key)?.asDouble ?: default
    fun int(key: String, default: Int = 0): Int = get(key)?.asInt ?: default
    fun bool(key: String, default: Boolean = false): Boolean = get(key)?.asBoolean ?: default
    fun array(key: String): List<JsonValue> = get(key)?.asArray ?: emptyList()
    fun obj(key: String): Map<String, JsonValue>? = get(key)?.asObject
}

object Json {
    fun parse(input: String): JsonValue {
        val p = Parser(input)
        val value = p.readValue()
        p.skipWs()
        if (!p.atEnd()) p.fail("Trailing content after JSON value")
        return value
    }

    /** Never throws for user-facing paths; callers decide how to report. */
    fun tryParse(input: String): JsonValue? = try { parse(input) } catch (_: JsonException) { null }

    fun stringify(value: JsonValue, pretty: Boolean = true): String {
        val sb = StringBuilder()
        write(value, sb, pretty, 0)
        return sb.toString()
    }

    private fun write(v: JsonValue, sb: StringBuilder, pretty: Boolean, depth: Int) {
        when (v) {
            is JsonValue.Null -> sb.append("null")
            is JsonValue.Bool -> sb.append(if (v.value) "true" else "false")
            is JsonValue.Num -> sb.append(if (v.value == Math.floor(v.value) && v.value.isFinite() && Math.abs(v.value) < 9.2e18) v.value.toLong().toString() else v.value.toString())
            is JsonValue.Str -> writeString(v.value, sb)
            is JsonValue.Arr -> {
                if (v.value.isEmpty()) { sb.append("[]"); return }
                sb.append('[')
                v.value.forEachIndexed { i, item ->
                    if (i > 0) sb.append(',')
                    if (pretty) newline(sb, depth + 1)
                    write(item, sb, pretty, depth + 1)
                }
                if (pretty) newline(sb, depth)
                sb.append(']')
            }
            is JsonValue.Obj -> {
                if (v.value.isEmpty()) { sb.append("{}"); return }
                sb.append('{')
                var i = 0
                for ((k, item) in v.value) {
                    if (i++ > 0) sb.append(',')
                    if (pretty) newline(sb, depth + 1)
                    writeString(k, sb)
                    sb.append(':')
                    if (pretty) sb.append(' ')
                    write(item, sb, pretty, depth + 1)
                }
                if (pretty) newline(sb, depth)
                sb.append('}')
            }
        }
    }

    private fun newline(sb: StringBuilder, depth: Int) {
        sb.append('\n')
        repeat(depth) { sb.append("  ") }
    }

    private fun writeString(s: String, sb: StringBuilder) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c.code < 0x20) sb.append("\\u%04x".format(c.code)) else sb.append(c)
            }
        }
        sb.append('"')
    }

    private class Parser(private val src: String) {
        private var i = 0
        fun atEnd(): Boolean = i >= src.length
        fun fail(msg: String): Nothing = throw JsonException("$msg at offset $i")
        fun skipWs() { while (i < src.length && (src[i] == ' ' || src[i] == '\n' || src[i] == '\r' || src[i] == '\t')) i++ }

        fun readValue(): JsonValue {
            skipWs()
            if (atEnd()) fail("Unexpected end of input")
            return when (src[i]) {
                '{' -> readObject()
                '[' -> readArray()
                '"' -> JsonValue.Str(readString())
                't' -> { expect("true"); JsonValue.Bool(true) }
                'f' -> { expect("false"); JsonValue.Bool(false) }
                'n' -> { expect("null"); JsonValue.Null }
                else -> readNumber()
            }
        }

        private fun expect(literal: String) {
            if (!src.startsWith(literal, i)) fail("Expected '$literal'")
            i += literal.length
        }

        private fun readObject(): JsonValue.Obj {
            i++ // {
            val map = LinkedHashMap<String, JsonValue>()
            skipWs()
            if (i < src.length && src[i] == '}') { i++; return JsonValue.Obj(map) }
            while (true) {
                skipWs()
                if (i >= src.length || src[i] != '"') fail("Expected object key")
                val key = readString()
                skipWs()
                if (i >= src.length || src[i] != ':') fail("Expected ':'")
                i++
                map[key] = readValue()
                skipWs()
                if (i >= src.length) fail("Unterminated object")
                when (src[i]) {
                    ',' -> i++
                    '}' -> { i++; return JsonValue.Obj(map) }
                    else -> fail("Expected ',' or '}'")
                }
            }
        }

        private fun readArray(): JsonValue.Arr {
            i++ // [
            val list = ArrayList<JsonValue>()
            skipWs()
            if (i < src.length && src[i] == ']') { i++; return JsonValue.Arr(list) }
            while (true) {
                list.add(readValue())
                skipWs()
                if (i >= src.length) fail("Unterminated array")
                when (src[i]) {
                    ',' -> i++
                    ']' -> { i++; return JsonValue.Arr(list) }
                    else -> fail("Expected ',' or ']'")
                }
            }
        }

        private fun readString(): String {
            i++ // opening quote
            val sb = StringBuilder()
            while (i < src.length) {
                val c = src[i++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (i >= src.length) fail("Unterminated escape")
                        when (val e = src[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > src.length) fail("Bad unicode escape")
                                val hex = src.substring(i, i + 4)
                                val code = hex.toIntOrNull(16) ?: fail("Bad unicode escape")
                                i += 4
                                sb.append(code.toChar())
                            }
                            else -> fail("Invalid escape '\\$e'")
                        }
                    }
                    c.code < 0x20 -> fail("Unescaped control character")
                    else -> sb.append(c)
                }
            }
            fail("Unterminated string")
        }

        private fun readNumber(): JsonValue.Num {
            val start = i
            if (i < src.length && src[i] == '-') i++
            while (i < src.length && src[i] in '0'..'9') i++
            if (i < src.length && src[i] == '.') {
                i++
                while (i < src.length && src[i] in '0'..'9') i++
            }
            if (i < src.length && (src[i] == 'e' || src[i] == 'E')) {
                i++
                if (i < src.length && (src[i] == '+' || src[i] == '-')) i++
                while (i < src.length && src[i] in '0'..'9') i++
            }
            val text = src.substring(start, i)
            val n = text.toDoubleOrNull() ?: fail("Invalid number '$text'")
            if (!n.isFinite()) fail("Non-finite number")
            return JsonValue.Num(n)
        }
    }
}

class JsonException(message: String) : IllegalArgumentException(message)

/** Small builder helpers, so codecs read declaratively. */
fun jObj(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj = JsonValue.Obj(linkedMapOf(*pairs))
fun jArr(items: List<JsonValue>): JsonValue.Arr = JsonValue.Arr(items)
fun jStr(value: String): JsonValue.Str = JsonValue.Str(value)
fun jNum(value: Number): JsonValue.Num = JsonValue.Num(value.toDouble())
fun jBool(value: Boolean): JsonValue.Bool = JsonValue.Bool(value)
fun jNull(): JsonValue.Null = JsonValue.Null
